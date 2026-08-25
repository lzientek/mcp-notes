import {
  withAuth,
  errorResponse,
  noContentResponse,
  requirePathParam,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mapInBatches, queryAll } from './helpers/dynamo.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Number of times to re-read a note whose tag list shifted under us before
 * giving up. A conflict needs a concurrent edit of the same note, so more than
 * a couple of rounds means something else is wrong.
 */
const MAX_TAG_REMOVAL_ATTEMPTS = 3;

/**
 * Strips one tag from a note with REMOVE #tags[i], which rewrites a single list
 * element instead of the whole item — so a concurrent edit to the note's title
 * or content is not clobbered.
 *
 * The index is only valid for the list we read, so the update is conditioned on
 * it. If a concurrent edit removed an earlier tag, the indices shift, the
 * condition fails, and the note is re-read: the tag is still there, just
 * somewhere else. Treating that as "nothing to repair" would leave the note
 * carrying a tag whose row is about to be deleted — it would keep rendering in
 * the UI and break the note's next update, with nothing to ever clean it up.
 */
async function removeTagFromNote(
  userId: string,
  noteId: string,
  tagName: string,
  knownTags: string[] | undefined,
  now: string,
): Promise<void> {
  let tags = knownTags ?? [];

  for (let attempt = 0; attempt < MAX_TAG_REMOVAL_ATTEMPTS; attempt += 1) {
    const index = tags.indexOf(tagName);
    if (index === -1) return; // genuinely gone

    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { userId, noteId },
          UpdateExpression: `REMOVE #tags[${String(index)}] SET updatedAt = :now`,
          ConditionExpression: `#tags[${String(index)}] = :tagName`,
          ExpressionAttributeNames: { '#tags': 'tags' },
          ExpressionAttributeValues: { ':tagName': tagName, ':now': now },
        }),
      );
      return;
    } catch (err) {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
        throw err;
      }
      const fresh = await client.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId, noteId },
          ProjectionExpression: '#tags',
          ExpressionAttributeNames: { '#tags': 'tags' },
        }),
      );
      tags = (fresh.Item?.tags as string[] | undefined) ?? [];
    }
  }

  // Better to fail the request — and leave the tag row in place — than to
  // delete it while notes still reference it.
  throw new Error(
    `Could not remove tag "${tagName}" from note ${noteId} after ${String(MAX_TAG_REMOVAL_ATTEMPTS)} attempts`,
  );
}

export const handler = withAuth(async (event, { userId }) => {
  const tagId = requirePathParam(event, 'tagId', 'Tag ID');

  // Get the tag to retrieve its name
  const tagResult = await client.send(
    new GetCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  if (!tagResult.Item) {
    return errorResponse(404, {
      code: 'TAG_NOT_FOUND',
      message: 'The requested tag was not found.',
      remedy: 'Verify the tag ID and try again.',
    });
  }

  const tagName = tagResult.Item.name as string;

  // Cascade: strip the tag from every note that carries it. DynamoDB does the
  // matching and returns only what is needed to build the update.
  const affectedNotes = await queryAll(client, {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'contains(#tags, :tagName)',
    ExpressionAttributeNames: { '#tags': 'tags' },
    ExpressionAttributeValues: { ':uid': userId, ':tagName': tagName },
    ProjectionExpression: 'noteId, #tags',
  });

  const now = new Date().toISOString();
  await mapInBatches(affectedNotes, (note) =>
    removeTagFromNote(userId, note.noteId as string, tagName, note.tags as string[] | undefined, now),
  );

  // Delete the tag
  await client.send(
    new DeleteCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  return noContentResponse();
});
