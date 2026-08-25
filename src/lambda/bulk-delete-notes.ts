import {
  withAuth,
  errorResponse,
  jsonResponse,
  parseBody,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

  // Delete each note and cascade delete shares
  for (const noteId of noteIds) {
    // Delete the note
    await client.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId, noteId },
      }),
    );

    // Cascade delete all share records for this note
    const sharesResult = await client.send(
      new QueryCommand({
        TableName: SHARES_TABLE_NAME,
        IndexName: 'NoteIdIndex',
        KeyConditionExpression: 'noteId = :nid',
        ExpressionAttributeValues: { ':nid': noteId },
      }),
    );

    const shares = sharesResult.Items ?? [];
    for (const share of shares) {
      await client.send(
        new DeleteCommand({
          TableName: SHARES_TABLE_NAME,
          Key: { shareId: share.shareId as string },
        }),
      );
    }
  }

  return jsonResponse(200, { deleted: noteIds.length });
});
