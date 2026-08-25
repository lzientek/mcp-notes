import {
  withAuth,
  errorResponse,
  jsonResponse,
  parseBody,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { batchDelete } from './helpers/dynamo.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const body = parseBody<{ noteIds?: string[] }>(
    event,
    'Send a JSON object with a noteIds array.',
  );

  const noteIds = body.noteIds;
  if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'noteIds array is required and must not be empty.',
      remedy: 'Provide a non-empty noteIds array (max 50 items).',
    });
  }

  if (noteIds.length > 50) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Cannot delete more than 50 notes at once.',
      remedy: 'Reduce the noteIds array to 50 items or fewer.',
    });
  }

  await batchDelete(
    client,
    TABLE_NAME,
    noteIds.map((noteId) => ({ userId, noteId })),
  );

  // Cascade: shares are keyed by shareId in their own table, so each note needs a
  // NoteIdIndex lookup. The lookups run concurrently, the deletes go out batched.
  const shareLookups = await Promise.all(
    noteIds.map((noteId) =>
      client.send(
        new QueryCommand({
          TableName: SHARES_TABLE_NAME,
          IndexName: 'NoteIdIndex',
          KeyConditionExpression: 'noteId = :nid',
          ExpressionAttributeValues: { ':nid': noteId },
        }),
      ),
    ),
  );

  const shareKeys = shareLookups.flatMap((result) =>
    (result.Items ?? []).map((share) => ({ shareId: share.shareId as string })),
  );

  if (shareKeys.length > 0) {
    await batchDelete(client, SHARES_TABLE_NAME, shareKeys);
  }

  return jsonResponse(200, { deleted: noteIds.length });
});
