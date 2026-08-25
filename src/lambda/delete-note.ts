import {
  withAuth,
  noContentResponse,
  requirePathParam,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const noteId = requirePathParam(event, 'noteId', 'Note ID');

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

  return noContentResponse();
});
