import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { CORS_HEADERS } from './helpers/cors.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return {
      statusCode: 401,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
        remedy: 'Ensure your request includes a valid authorization token.',
      }),
    };
  }

  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Number(params.limit) || 20, 100);
  const cursor = params.cursor;
  const searchQuery = params.search?.toLowerCase();
  const tagsFilter = params.tags ? params.tags.split(',').map((t) => t.trim().toLowerCase()) : null;
  const fromDate = params.from ?? null;
  const toDate = params.to ?? null;
  const favoritesOnly = params.favorites === 'true';
  const scope = params.scope ?? 'own';

  // Validate scope parameter
  if (!['own', 'shared', 'all'].includes(scope)) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Invalid scope parameter. Must be "own", "shared", or "all".',
        remedy: 'Use scope=own, scope=shared, or scope=all.',
      }),
    };
  }

  let ownNotes: Record<string, unknown>[] = [];
  let sharedNotes: Record<string, unknown>[] = [];

  // Fetch own notes
  if (scope === 'own' || scope === 'all') {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ...(cursor && scope === 'own' ? { ExclusiveStartKey: { userId, noteId: cursor } } : {}),
      }),
    );
    ownNotes = result.Items ?? [];
  }

  // Fetch shared notes
  if (scope === 'shared' || scope === 'all') {
    const callerEmail = event.requestContext.authorizer?.claims?.email;
    if (callerEmail) {
      // Query GSI2 (RecipientEmailIndex) for shares with this recipient
      const sharesResult = await client.send(
        new QueryCommand({
          TableName: SHARES_TABLE_NAME,
          IndexName: 'RecipientEmailIndex',
          KeyConditionExpression: 'recipientEmail = :email',
          ExpressionAttributeValues: { ':email': callerEmail },
        }),
      );

      const shares = sharesResult.Items ?? [];

      if (shares.length > 0) {
        // BatchGetItem to fetch the actual notes
        // DynamoDB BatchGetItem limit is 100 items per call
        const keys = shares.map((share) => ({
          userId: share.userId as string,
          noteId: share.noteId as string,
        }));

        // Process in chunks of 100
        for (let i = 0; i < keys.length; i += 100) {
          const chunk = keys.slice(i, i + 100);
          const batchResult = await client.send(
            new BatchGetCommand({
              RequestItems: {
                [TABLE_NAME]: { Keys: chunk },
              },
            }),
          );

          const fetchedNotes = batchResult.Responses?.[TABLE_NAME] ?? [];

          // Merge note data with share metadata
          for (const note of fetchedNotes) {
            const share = shares.find(
              (s) => s.noteId === note.noteId && s.userId === note.userId,
            );
            if (share) {
              sharedNotes.push({
                ...note,
                isShared: true,
                ownerId: share.userId as string,
                permission: share.permission as string,
                sharedAt: share.createdAt as string,
              });
            }
          }
        }
      }
    }
  }

  // Merge results based on scope
  let notes: Record<string, unknown>[];
  if (scope === 'own') {
    notes = ownNotes;
  } else if (scope === 'shared') {
    notes = sharedNotes;
  } else {
    // scope === 'all': own notes first, then shared
    notes = [...ownNotes, ...sharedNotes];
  }

  // Apply filters in-memory
  if (tagsFilter && tagsFilter.length > 0) {
    notes = notes.filter((note) => {
      const noteTags = (note.tags as string[] | undefined) ?? [];
      return tagsFilter.some((tag) => noteTags.includes(tag));
    });
  }

  if (fromDate) {
    notes = notes.filter((note) => (note.createdAt as string) >= fromDate);
  }

  if (toDate) {
    // Add end-of-day to make "to" inclusive
    const toEnd = toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
    notes = notes.filter((note) => (note.createdAt as string) <= toEnd);
  }

  if (searchQuery) {
    notes = notes.filter((note) => {
      const title = ((note.title as string) ?? '').toLowerCase();
      const content = ((note.content as string) ?? '').toLowerCase();
      return title.includes(searchQuery) || content.includes(searchQuery);
    });
  }

  if (favoritesOnly) {
    notes = notes.filter((note) => note.isFavorite === true);
  }

  // Sort by updatedAt descending
  notes.sort((a, b) =>
    (b.updatedAt as string).localeCompare(a.updatedAt as string),
  );

  // Paginate
  const paginatedNotes = notes.slice(0, limit);
  const nextCursor =
    paginatedNotes.length === limit && notes.length > limit
      ? (paginatedNotes[paginatedNotes.length - 1].noteId as string)
      : null;

  // Ensure isFavorite field (retrocompat)
  const output = paginatedNotes.map((note) => ({
    ...note,
    isFavorite: note.isFavorite ?? false,
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ notes: output, nextCursor }),
  };
};
