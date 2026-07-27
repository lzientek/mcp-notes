import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

  const noteId = event.pathParameters?.noteId;
  if (!noteId) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Note ID is required.',
        remedy: 'Include the note ID in the URL path.',
      }),
    };
  }

  const params = event.queryStringParameters ?? {};
  const type = params.type;
  const email = params.email;

  if (!type && !email) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Either type=public or email=... query parameter is required.',
        remedy: 'Specify ?type=public to revoke the public link or ?email=user@example.com to revoke a user share.',
      }),
    };
  }

  // Verify note exists and caller is the owner
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (!noteResult.Item) {
    return {
      statusCode: 403,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'FORBIDDEN',
        message: 'You do not have permission to manage shares for this note.',
        remedy: 'Ensure you are the owner of this note.',
      }),
    };
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

  return {
    statusCode: 204,
    headers: { ...CORS_HEADERS },
    body: '',
  };
};
