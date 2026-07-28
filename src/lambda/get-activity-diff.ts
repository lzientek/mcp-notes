import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
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
  const params = event.queryStringParameters ?? {};
  const timestamp = params.timestamp;

  if (!noteId || !timestamp) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'noteId and timestamp query parameter are required.',
        remedy: 'Include noteId in the path and timestamp as a query parameter.',
      }),
    };
  }

  // Access check: owner or shared recipient
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  let hasAccess = !!noteResult.Item;

  if (!hasAccess) {
    const callerEmail = event.requestContext.authorizer?.claims?.email;
    if (callerEmail) {
      const sharesResult = await client.send(
        new QueryCommand({
          TableName: SHARES_TABLE_NAME,
          IndexName: 'NoteIdIndex',
          KeyConditionExpression: 'noteId = :nid',
          ExpressionAttributeValues: { ':nid': noteId },
        }),
      );
      hasAccess = (sharesResult.Items ?? []).some(
        (item) => item.recipientEmail === callerEmail,
      );
    }
  }

  if (!hasAccess) {
    return {
      statusCode: 404,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'NOTE_NOT_FOUND',
        message: 'The requested note was not found.',
        remedy: 'Verify the note ID and try again.',
      }),
    };
  }

  // Fetch the diff item
  const result = await client.send(
    new GetCommand({
      TableName: ACTIVITY_TABLE_NAME,
      Key: { noteId, timestamp: `diff#${timestamp}` },
    }),
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'DIFF_NOT_FOUND',
        message: 'Diff not found or expired (diffs are kept for 30 days).',
        remedy: 'The diff may have expired. Only the last 30 days of diffs are available.',
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ hunks: result.Item.hunks }),
  };
};
