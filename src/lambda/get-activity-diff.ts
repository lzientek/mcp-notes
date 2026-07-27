import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;

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
