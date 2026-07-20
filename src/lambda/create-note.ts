import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
        remedy: 'Ensure your request includes a valid authorization token.',
      }),
    };
  }

  let body: { title?: string; content?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with title and content fields.',
      }),
    };
  }

  const title = body.title ?? 'Untitled';
  const content = body.content ?? '';
  const now = new Date().toISOString();
  const noteId = ulid();

  const note = {
    userId,
    noteId,
    title,
    content,
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  };
};
