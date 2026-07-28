import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;

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

  const name = body.name?.trim();
  if (!name || name.length === 0 || name.length > 100) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Folder name is required and must be between 1 and 100 characters.',
        remedy: 'Provide a non-empty name field (max 100 characters).',
      }),
    };
  }

  const folderId = name.toLowerCase();

  // Check uniqueness via direct key lookup
  const existing = await client.send(
    new GetCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { userId, folderId },
    }),
  );

  if (existing.Item) {
    return {
      statusCode: 409,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'FOLDER_EXISTS',
        message: `A folder named "${name}" already exists.`,
        remedy: 'Use the existing folder or choose a different name.',
      }),
    };
  }

  const now = new Date().toISOString();

  const folder = { userId, folderId, name, createdAt: now };

  await client.send(
    new PutCommand({
      TableName: FOLDERS_TABLE_NAME,
      Item: folder,
    }),
  );

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ folderId, name, createdAt: now }),
  };
};
