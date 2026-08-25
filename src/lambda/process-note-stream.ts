import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { batchDelete, batchPut } from './helpers/dynamo.js';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';
import { computeDiff } from './helpers/line-diff.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
const MAX_EVENTS_PER_NOTE = 200;
const DIFF_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const EVENT_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
/** Activity events use an ISO timestamp as sort key; diffs use a "diff#" prefix. */
const EVENT_SORT_KEY_PREFIX = '20';

interface ActivityEvent {
  noteId: string;
  timestamp: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  source: string | null;
  details: Record<string, unknown> | null;
}

function toRecord(image: Record<string, AttributeValue> | undefined): Record<string, unknown> | null {
  if (!image) return null;
  return unmarshall(image) as Record<string, unknown>;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

interface DiffItem {
  noteId: string;
  timestamp: string;
  hunks: unknown;
  ttl: number;
}

function detectChanges(
  oldImage: Record<string, unknown>,
  newImage: Record<string, unknown>,
): { events: ActivityEvent[]; diffItems: DiffItem[] } {
  const noteId = newImage.noteId as string;
  const now = newImage.updatedAt as string ?? new Date().toISOString();
  const actorId = (newImage.lastModifiedByUser as string) ?? (newImage.userId as string) ?? null;
  const actorEmail = (newImage.lastModifiedByUser as string) ?? null;
  const source = (newImage.lastModifiedBy as string) ?? null;

  const events: ActivityEvent[] = [];
  const diffItems: DiffItem[] = [];

  const makeEvent = (action: string, details: Record<string, unknown> | null): ActivityEvent => ({
    noteId,
    timestamp: `${now}#${ulid()}`,
    action,
    actorId,
    actorEmail,
    source,
    details,
  });

  // Title changed
  if (oldImage.title !== newImage.title) {
    events.push(makeEvent('title_changed', {
      oldTitle: oldImage.title as string,
      newTitle: newImage.title as string,
    }));
  }

  // Content changed
  if (oldImage.content !== newImage.content) {
    const eventTs = `${now}#${ulid()}`;
    events.push(makeEvent('content_updated', { hasDiff: true }));
    // Override the timestamp to match the diff item
    events[events.length - 1].timestamp = eventTs;

    // Compute diff and store separately
    const hunks = computeDiff(
      (oldImage.content as string) ?? '',
      (newImage.content as string) ?? '',
    );
    diffItems.push({
      noteId,
      timestamp: `diff#${eventTs}`,
      hunks,
      ttl: Math.floor(Date.now() / 1000) + DIFF_TTL_SECONDS,
    });
  }

  // Tags diff
  const oldTags = (oldImage.tags as string[]) ?? [];
  const newTags = (newImage.tags as string[]) ?? [];
  if (!arraysEqual(oldTags, newTags)) {
    const added = newTags.filter((t) => !oldTags.includes(t));
    const removed = oldTags.filter((t) => !newTags.includes(t));
    if (added.length > 0) {
      events.push(makeEvent('tags_added', { added }));
    }
    if (removed.length > 0) {
      events.push(makeEvent('tags_removed', { removed }));
    }
  }

  // Folder changed
  const oldFolder = (oldImage.folderId as string | null) ?? null;
  const newFolder = (newImage.folderId as string | null) ?? null;
  if (oldFolder !== newFolder) {
    events.push(makeEvent('folder_changed', {
      oldFolderId: oldFolder ?? 'root',
      newFolderId: newFolder ?? 'root',
    }));
  }

  // Favorite toggled
  const oldFav = (oldImage.isFavorite as boolean) ?? false;
  const newFav = (newImage.isFavorite as boolean) ?? false;
  if (oldFav !== newFav) {
    events.push(makeEvent('favorite_toggled', { isFavorite: newFav }));
  }

  return { events, diffItems };
}

/**
 * Trims a note's oldest activity events past MAX_EVENTS_PER_NOTE.
 *
 * The read is bounded: it asks for at most MAX_EVENTS_PER_NOTE + 1 keys, oldest
 * first, so the common case (a note under the cap) costs one small query instead
 * of reading the note's whole activity history — diff blobs included — on every
 * single write. The begins_with keeps diff items out of the count; they carry
 * their own 30-day TTL.
 */
async function purgeOldEvents(noteId: string): Promise<void> {
  const result = await client.send(
    new QueryCommand({
      TableName: ACTIVITY_TABLE_NAME,
      KeyConditionExpression: 'noteId = :nid AND begins_with(#ts, :eventPrefix)',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':nid': noteId,
        ':eventPrefix': EVENT_SORT_KEY_PREFIX,
      },
      ProjectionExpression: 'noteId, #ts',
      ScanIndexForward: true, // oldest first
      Limit: MAX_EVENTS_PER_NOTE + 1,
    }),
  );

  const items = result.Items ?? [];
  if (items.length <= MAX_EVENTS_PER_NOTE) return;

  await batchDelete(
    client,
    ACTIVITY_TABLE_NAME,
    items
      .slice(0, items.length - MAX_EVENTS_PER_NOTE)
      .map((item) => ({ noteId: item.noteId, timestamp: item.timestamp })),
  );
}

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const itemsToWrite: Record<string, unknown>[] = [];
  const touchedNoteIds = new Set<string>();

  for (const record of event.Records) {
    try {
      const eventName = record.eventName;
      const newImage = toRecord(record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined);
      const oldImage = toRecord(record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined);

      if (!newImage && !oldImage) continue;

      const noteId = (newImage?.noteId ?? oldImage?.noteId) as string;
      if (!noteId) continue;

      let events: ActivityEvent[] = [];
      let diffItems: DiffItem[] = [];

      if (eventName === 'INSERT' && newImage) {
        // Note created
        events.push({
          noteId,
          timestamp: `${(newImage.createdAt as string) ?? new Date().toISOString()}#${ulid()}`,
          action: 'note_created',
          actorId: (newImage.lastModifiedByUser as string) ?? (newImage.userId as string) ?? null,
          actorEmail: (newImage.lastModifiedByUser as string) ?? null,
          source: (newImage.lastModifiedBy as string) ?? null,
          details: { title: newImage.title as string },
        });
      } else if (eventName === 'MODIFY' && oldImage && newImage) {
        // Note updated — detect what changed
        const changes = detectChanges(oldImage, newImage);
        events = changes.events;
        diffItems = changes.diffItems;
      } else if (eventName === 'REMOVE') {
        // Note deleted — nothing to record, the TTL cleans up the history
        continue;
      }

      if (events.length === 0 && diffItems.length === 0) continue;

      const eventTtl = Math.floor(Date.now() / 1000) + EVENT_TTL_SECONDS;
      itemsToWrite.push(
        ...events.map((activityEvent) => ({ ...activityEvent, ttl: eventTtl })),
        // Diff items carry their own, shorter TTL.
        ...diffItems.map((diffItem) => ({ ...diffItem })),
      );

      if (events.length > 0) touchedNoteIds.add(noteId);
    } catch (err) {
      // Log but don't throw — one bad record must not block the stream.
      console.error('Error processing stream record:', err);
    }
  }

  try {
    if (itemsToWrite.length > 0) {
      await batchPut(client, ACTIVITY_TABLE_NAME, itemsToWrite);
    }

    // Purge once per note, not once per record: a batch often carries several
    // updates to the same note.
    for (const noteId of touchedNoteIds) {
      await purgeOldEvents(noteId);
    }
  } catch (err) {
    console.error('Error writing activity events:', err);
  }
};
