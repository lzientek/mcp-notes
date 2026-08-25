import {
  withAuth,
  errorResponse,
  noContentResponse,
  requirePathParam,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const noteId = requirePathParam(event, 'noteId', 'Note ID');

  const params = event.queryStringParameters ?? {};
  const type = params.type;
  const email = params.email;

  if (!type && !email) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Either type=public or email=... query parameter is required.',
      remedy: 'Specify ?type=public to revoke the public link or ?email=user@example.com to revoke a user share.',
    });
  }

  // Verify note exists and caller is the owner
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (!noteResult.Item) {
    return errorResponse(403, {
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage shares for this note.',
      remedy: 'Ensure you are the owner of this note.',
    });
  }

  // Query shares for this note
  const existingShares = await client.send(
    new QueryCommand({
      TableName: SHARES_TABLE_NAME,
      IndexName: 'NoteIdIndex',
      KeyConditionExpression: 'noteId = :nid',
      ExpressionAttributeValues: { ':nid': noteId },
    }),
  );

  const shares = existingShares.Items ?? [];

  if (type === 'public') {
    const publicShare = shares.find((s) => s.type === 'public');
    if (publicShare) {
      await client.send(
        new DeleteCommand({
          TableName: SHARES_TABLE_NAME,
          Key: { shareId: publicShare.shareId },
        }),
      );
    }
  } else if (email) {
    const userShare = shares.find(
      (s) => s.type === 'user' && s.recipientEmail === email,
    );
    if (userShare) {
      await client.send(
        new DeleteCommand({
          TableName: SHARES_TABLE_NAME,
          Key: { shareId: userShare.shareId },
        }),
      );
    }
  }

  return noContentResponse();
});
