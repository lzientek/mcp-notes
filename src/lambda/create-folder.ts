import {
  withAuth,
  errorResponse,
  jsonResponse,
  parseBody,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const body = parseBody<{ name?: string }>(
    event,
    'Send a JSON object with a name field.',
  );

  const name = body.name?.trim();
  if (!name || name.length === 0 || name.length > 100) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Folder name is required and must be between 1 and 100 characters.',
      remedy: 'Provide a non-empty name field (max 100 characters).',
    });
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
    return errorResponse(409, {
      code: 'FOLDER_EXISTS',
      message: `A folder named "${name}" already exists.`,
      remedy: 'Use the existing folder or choose a different name.',
    });
  }

  const now = new Date().toISOString();

  const folder = { userId, folderId, name, createdAt: now };

  await client.send(
    new PutCommand({
      TableName: FOLDERS_TABLE_NAME,
      Item: folder,
    }),
  );

  return jsonResponse(201, { folderId, name, createdAt: now });
});
