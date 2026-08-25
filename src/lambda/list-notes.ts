import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ApiError, withAuth, errorResponse, jsonResponse } from './helpers/http.js';
import type { NoteItem, SharedNote, SharePermission } from '../types/notes.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

/** GSI on (userId, updatedAt) — lets DynamoDB return notes already sorted. */
const UPDATED_AT_INDEX = 'UpdatedAtIndex';

/**
 * A FilterExpression is applied after Limit, so a page can come back short while
 * more matches remain. We follow LastEvaluatedKey until the page is full, but cap
 * the number of round-trips so one request can never fan out unboundedly.
 */
const MAX_QUERY_PAGES = 10;

/** What DynamoDB hands back: a note, plus share metadata for shared ones. */
type Item = NoteItem | (NoteItem & Partial<SharedNote>);

interface NoteFilters {
  tags: string[] | null;
  fromDate: string | null;
  toDate: string | null;
  favoritesOnly: boolean;
  folderId: string | null;
  search: string | undefined;
}

interface PageKey {
  userId: string;
  noteId: string;
  updatedAt: string;
}

function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function invalidCursor(): ApiError {
  return new ApiError(400, {
    code: 'INVALID_CURSOR',
    message: 'The pagination cursor is not valid.',
    remedy: 'Drop the cursor parameter to restart from the first page.',
  });
}

/**
 * Decodes a cursor and checks it is a usable ExclusiveStartKey for this caller.
 * Without the shape check, a decodable but incomplete key reaches DynamoDB and
 * comes back as a ValidationException — a 500, where the remedy above is what
 * the caller actually needs. The userId check keeps the error honest too: the
 * key condition already binds the query to the caller.
 */
function decodeCursor(cursor: string, userId: string): PageKey {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (!decoded || typeof decoded !== 'object') throw invalidCursor();
  const key = decoded as Record<string, unknown>;

  if (!isString(key.userId) || !isString(key.noteId) || !isString(key.updatedAt)) {
    throw invalidCursor();
  }
  if (key.userId !== userId) throw invalidCursor();

  return { userId: key.userId, noteId: key.noteId, updatedAt: key.updatedAt };
}

/** Normalises the "to" bound so a bare date stays inclusive. */
function endOfDay(toDate: string): string {
  return toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
}

/** Everything except free-text search, which DynamoDB cannot do case-insensitively. */
function buildFilterExpression(filters: NoteFilters): {
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  if (filters.tags && filters.tags.length > 0) {
    names['#tags'] = 'tags';
    const ors = filters.tags.map((tag, i) => {
      values[`:tag${i}`] = tag;
      return `contains(#tags, :tag${i})`;
    });
    clauses.push(`(${ors.join(' OR ')})`);
  }

  if (filters.fromDate) {
    names['#createdAt'] = 'createdAt';
    values[':fromDate'] = filters.fromDate;
    clauses.push('#createdAt >= :fromDate');
  }

  if (filters.toDate) {
    names['#createdAt'] = 'createdAt';
    values[':toDate'] = endOfDay(filters.toDate);
    clauses.push('#createdAt <= :toDate');
  }

  if (filters.favoritesOnly) {
    names['#isFavorite'] = 'isFavorite';
    values[':true'] = true;
    clauses.push('#isFavorite = :true');
  }

  if (filters.folderId) {
    names['#folderId'] = 'folderId';
    if (filters.folderId === 'root') {
      values[':null'] = null;
      clauses.push('(attribute_not_exists(#folderId) OR #folderId = :null)');
    } else {
      values[':folderId'] = filters.folderId;
      clauses.push('#folderId = :folderId');
    }
  }

  if (clauses.length === 0) return {};
  return {
    FilterExpression: clauses.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

function matchesSearch(note: Item, search: string): boolean {
  const title = (note.title ?? '').toLowerCase();
  const content = (note.content ?? '').toLowerCase();
  return title.includes(search) || content.includes(search);
}

/** Used for shared notes, which are gathered by BatchGet and cannot be filtered by the query. */
function applyInMemoryFilters(notes: Item[], filters: NoteFilters): Item[] {
  let result = notes;

  if (filters.tags && filters.tags.length > 0) {
    const wanted = filters.tags;
    result = result.filter((note) => {
      const noteTags = note.tags ?? [];
      return wanted.some((tag) => noteTags.includes(tag));
    });
  }
  if (filters.fromDate) {
    const from = filters.fromDate;
    result = result.filter((note) => (note.createdAt ?? '') >= from);
  }
  if (filters.toDate) {
    const to = endOfDay(filters.toDate);
    result = result.filter((note) => (note.createdAt ?? '') <= to);
  }
  if (filters.search) {
    const search = filters.search;
    result = result.filter((note) => matchesSearch(note, search));
  }
  if (filters.favoritesOnly) {
    result = result.filter((note) => note.isFavorite === true);
  }
  if (filters.folderId === 'root') {
    result = result.filter((note) => !note.folderId);
  } else if (filters.folderId) {
    result = result.filter((note) => note.folderId === filters.folderId);
  }

  return result;
}

function withDefaults(notes: Item[]): Item[] {
  return notes.map((note) => ({ ...note, isFavorite: note.isFavorite ?? false }));
}

/**
 * Owner notes, paginated by DynamoDB itself: the UpdatedAtIndex returns them
 * newest-first, so the cursor is a real key and never skips or repeats a note.
 */
async function queryOwnNotes(
  userId: string,
  limit: number,
  filters: NoteFilters,
  cursor: string | undefined,
): Promise<{ notes: Item[]; nextCursor: string | null }> {
  const filterExpression = buildFilterExpression(filters);
  const collected: Item[] = [];
  let startKey: PageKey | undefined = cursor
    ? decodeCursor(cursor, userId)
    : undefined;
  let pages = 0;

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: UPDATED_AT_INDEX,
        KeyConditionExpression: 'userId = :uid',
        ScanIndexForward: false, // newest first
        Limit: limit,
        ...filterExpression,
        ExpressionAttributeValues: {
          ...filterExpression.ExpressionAttributeValues,
          ':uid': userId,
        },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    pages += 1;
    const items = (result.Items ?? []) as Item[];
    collected.push(
      ...(filters.search
        ? items.filter((item) => matchesSearch(item, filters.search!))
        : items),
    );
    startKey = result.LastEvaluatedKey as PageKey | undefined;
  } while (startKey && collected.length < limit && pages < MAX_QUERY_PAGES);

  const page = collected.slice(0, limit);
  const dropped = collected.slice(limit);

  // Where the next page resumes. Normally that is where DynamoDB stopped, even
  // if the filters rejected most of what it read: rewinding to the last
  // *returned* note would make the next request re-evaluate the same items, so
  // a sparse filter would degrade into re-scanning the partition once per page.
  // The one exception is a page trimmed by the slice above: those notes were
  // read but not returned, so they have to be read again.
  let nextCursor: string | null = null;
  if (dropped.length > 0) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeCursor({
        userId,
        noteId: last.noteId ?? '',
        updatedAt: last.updatedAt ?? '',
      });
    }
  } else if (startKey) {
    nextCursor = encodeCursor(startKey);
  }

  return { notes: withDefaults(page), nextCursor };
}

/** Notes shared with the caller, resolved through the RecipientEmailIndex. */
async function fetchSharedNotes(email: string | null): Promise<Item[]> {
  if (!email) return [];

  const sharesResult = await client.send(
    new QueryCommand({
      TableName: SHARES_TABLE_NAME,
      IndexName: 'RecipientEmailIndex',
      KeyConditionExpression: 'recipientEmail = :email',
      ExpressionAttributeValues: { ':email': email },
    }),
  );

  const shares = sharesResult.Items ?? [];
  if (shares.length === 0) return [];

  const keys = shares.map((share) => ({
    userId: share.userId as string,
    noteId: share.noteId as string,
  }));

  const sharedNotes: Item[] = [];
  // BatchGetItem accepts at most 100 keys per call.
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const batchResult = await client.send(
      new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: chunk } } }),
    );

    for (const note of (batchResult.Responses?.[TABLE_NAME] ?? []) as NoteItem[]) {
      const share = shares.find(
        (s) => s.noteId === note.noteId && s.userId === note.userId,
      );
      if (share) {
        sharedNotes.push({
          ...note,
          isShared: true,
          ownerId: share.userId as string,
          permission: share.permission as SharePermission,
          sharedAt: share.createdAt as string,
        });
      }
    }
  }

  return sharedNotes;
}

export const handler = withAuth(async (event, { userId, email }) => {
  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Number(params.limit) || 20, 100);
  const cursor = params.cursor;
  const scope = params.scope ?? 'own';

  if (!['own', 'shared', 'all'].includes(scope)) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Invalid scope parameter. Must be "own", "shared", or "all".',
      remedy: 'Use scope=own, scope=shared, or scope=all.',
    });
  }

  const filters: NoteFilters = {
    tags: params.tags
      ? params.tags.split(',').map((t) => t.trim().toLowerCase())
      : null,
    fromDate: params.from ?? null,
    toDate: params.to ?? null,
    favoritesOnly: params.favorites === 'true',
    folderId: params.folderId ?? null,
    search: params.search?.toLowerCase(),
  };

  if (scope === 'own') {
    const { notes, nextCursor } = await queryOwnNotes(
      userId,
      limit,
      filters,
      cursor,
    );
    return jsonResponse(200, { notes, nextCursor, hasMore: nextCursor !== null });
  }

  // Shared notes live under another user's partition key, so they cannot share a
  // DynamoDB cursor with the caller's own notes: these scopes stay in-memory and
  // return a single page.
  const shared = applyInMemoryFilters(await fetchSharedNotes(email), filters);

  let notes: Item[];
  if (scope === 'shared') {
    notes = shared;
  } else {
    const own = await queryOwnNotes(userId, limit, filters, undefined);
    notes = [...own.notes, ...shared];
  }

  notes = notes.toSorted((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  );

  // These scopes cannot paginate, so say so rather than returning a short list
  // with a null cursor, which is indistinguishable from a complete one.
  return jsonResponse(200, {
    notes: withDefaults(notes.slice(0, limit)),
    nextCursor: null,
    hasMore: notes.length > limit,
  });
});
