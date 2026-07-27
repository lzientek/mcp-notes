import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { validateTags } from './helpers/validate-tags.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
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

  let body: { title?: string; content?: string; tags?: string[]; isFavorite?: boolean; source?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with title and content fields.',
      }),
    };
  }

  const title = body.title ?? 'Untitled';
  const content = body.content ?? '';
  const tags = body.tags ?? [];
  const isFavorite = body.isFavorite ?? false;
  const source = body.source ?? null;

  // Validate tags if provided
  if (tags.length > 0) {
    const validation = await validateTags(client, TAGS_TABLE_NAME, userId, tags);
    if (!validation.valid) {
      return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
          code: 'INVALID_TAGS',
          message: 'Some tags do not exist.',
          invalidTags: validation.invalidTags,
        }),
      };
    }
  }

  const now = new Date().toISOString();
  const noteId = ulid();

  const note = {
    userId,
    noteId,
    title,
    content,
    tags: tags.map((t) => t.toLowerCase()),
    isFavorite,
    lastModifiedBy: source,
    lastModifiedByUser: event.requestContext.authorizer?.claims?.email ?? userId,
    createdAt: now,
    updatedAt: now,
  };

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: note,
    }),
  );

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(note),
  };
};
