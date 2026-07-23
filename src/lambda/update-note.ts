import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
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

  let body: { title?: string; content?: string; tags?: string[] };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with title and/or content fields.',
      }),
    };
  }

  // Check note exists and belongs to user
  const existing = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (!existing.Item) {
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

  // Validate tags if provided
  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    tags = body.tags.map((t) => t.toLowerCase());
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
  }

  const updatedNote = {
    ...existing.Item,
    title: body.title ?? existing.Item.title,
    content: body.content ?? existing.Item.content,
    tags: tags !== undefined ? tags : (existing.Item.tags ?? []),
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedNote,
      ConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(updatedNote),
  };
};
