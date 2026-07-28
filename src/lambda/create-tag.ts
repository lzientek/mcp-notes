import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;

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

  let body: { name?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with a name field.',
      }),
    };
  }

  const rawName = body.name?.trim();
  if (!rawName || rawName.length === 0 || rawName.length > 50) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Tag name is required and must be between 1 and 50 characters.',
        remedy: 'Provide a non-empty name field (max 50 characters).',
      }),
    };
  }

  const name = rawName.toLowerCase();

  // Check uniqueness via direct key lookup
  const existing = await client.send(
    new GetCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId: name },
    }),
  );

  if (existing.Item) {
    return {
      statusCode: 409,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'TAG_EXISTS',
        message: `A tag named "${name}" already exists.`,
        remedy: 'Use the existing tag or choose a different name.',
      }),
    };
  }

  const now = new Date().toISOString();

  const tag = { userId, tagId: name, name, createdAt: now };

  await client.send(
    new PutCommand({
      TableName: TAGS_TABLE_NAME,
      Item: tag,
    }),
  );

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ tagId: name, name, createdAt: now }),
  };
};
