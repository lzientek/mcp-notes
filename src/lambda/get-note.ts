import {
  withAuth,
  errorResponse,
  jsonResponse,
  requirePathParam,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId, email }) => {
  const noteId = requirePathParam(event, 'noteId', 'Note ID');

  // Try owner path first
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (result.Item) {
    return jsonResponse(200, { ...result.Item, isFavorite: result.Item.isFavorite ?? false });
  }

  // Not found as owner — check if caller is a share recipient
    if (email) {
    const sharesResult = await client.send(
      new QueryCommand({
        TableName: SHARES_TABLE_NAME,
        IndexName: 'NoteIdIndex',
        KeyConditionExpression: 'noteId = :nid',
        ExpressionAttributeValues: { ':nid': noteId },
      }),
    );

    const shareRecord = (sharesResult.Items ?? []).find(
      (item) => item.recipientEmail === email,
    );

    if (shareRecord) {
      const ownerUserId = shareRecord.userId as string;
      const noteResult = await client.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: ownerUserId, noteId },
        }),
      );

      if (noteResult.Item) {
        return jsonResponse(200, {
          ...noteResult.Item,
          isFavorite: noteResult.Item.isFavorite ?? false,
          isShared: true,
          permission: shareRecord.permission,
        });
      }
    }
  }

  return errorResponse(404, {
    code: 'NOTE_NOT_FOUND',
    message: 'The requested note was not found.',
    remedy: 'Verify the note ID and try again.',
  });
});
