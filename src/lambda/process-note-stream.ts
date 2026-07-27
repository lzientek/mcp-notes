import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
const MAX_EVENTS_PER_NOTE = 200;

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

function detectChanges(
  oldImage: Record<string, unknown>,
  newImage: Record<string, unknown>,
): ActivityEvent[] {
  const noteId = newImage.noteId as string;
  const now = newImage.updatedAt as string ?? new Date().toISOString();
  const actorId = (newImage.lastModifiedByUser as string) ?? (newImage.userId as string) ?? null;
  const actorEmail = (newImage.lastModifiedByUser as string) ?? null;
  const source = (newImage.lastModifiedBy as string) ?? null;

  const events: ActivityEvent[] = [];

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
    events.push(makeEvent('content_updated', null));
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

  return events;
}

async function purgeOldEvents(noteId: string): Promise<void> {
  const result = await client.send(
    new QueryCommand({
      TableName: ACTIVITY_TABLE_NAME,
      KeyConditionExpression: 'noteId = :nid',
      ExpressionAttributeValues: { ':nid': noteId },
      ScanIndexForward: true, // oldest first
    }),
  );

  const items = result.Items ?? [];
  if (items.length <= MAX_EVENTS_PER_NOTE) return;

  // Delete the oldest events beyond the limit
  const toDelete = items.slice(0, items.length - MAX_EVENTS_PER_NOTE);
  for (const item of toDelete) {
    await client.send(
      new DeleteCommand({
        TableName: ACTIVITY_TABLE_NAME,
        Key: { noteId: item.noteId, timestamp: item.timestamp },
      }),
    );
  }
}

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      const eventName = record.eventName;
      const newImage = toRecord(record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined);
      const oldImage = toRecord(record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined);

      if (!newImage && !oldImage) continue;

      const noteId = (newImage?.noteId ?? oldImage?.noteId) as string;
      if (!noteId) continue;

      let events: ActivityEvent[] = [];

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
        events = detectChanges(oldImage, newImage);
      } else if (eventName === 'REMOVE' && oldImage) {
        // Note deleted — we don't track this in activity (note is gone)
        // But we could clean up activity records
        // For now, TTL will handle cleanup
        continue;
      }

      // Write events to Activity table
      for (const activityEvent of events) {
        await client.send(
          new PutCommand({
            TableName: ACTIVITY_TABLE_NAME,
            Item: {
              ...activityEvent,
              ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
            },
          }),
        );
      }

      // Purge old events if necessary
      if (events.length > 0) {
        await purgeOldEvents(noteId);
      }
    } catch (err) {
      // Log but don't throw — we don't want to block the stream
      console.error('Error processing stream record:', err);
    }
  }
};
