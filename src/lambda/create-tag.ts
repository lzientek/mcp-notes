import {
  withAuth,
  errorResponse,
  jsonResponse,
  parseBody,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const body = parseBody<{ name?: string }>(
    event,
    'Send a JSON object with a name field.',
  );

  const rawName = body.name?.trim();
  if (!rawName || rawName.length === 0 || rawName.length > 50) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Tag name is required and must be between 1 and 50 characters.',
      remedy: 'Provide a non-empty name field (max 50 characters).',
    });
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
    return errorResponse(409, {
      code: 'TAG_EXISTS',
      message: `A tag named "${name}" already exists.`,
      remedy: 'Use the existing tag or choose a different name.',
    });
  }

  const now = new Date().toISOString();

  const tag = { userId, tagId: name, name, createdAt: now };

  await client.send(
    new PutCommand({
      TableName: TAGS_TABLE_NAME,
      Item: tag,
    }),
  );

  return jsonResponse(201, { tagId: name, name, createdAt: now });
});
