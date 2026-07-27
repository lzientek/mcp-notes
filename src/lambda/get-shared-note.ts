import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

// Public endpoint — allow all origins
const PUBLIC_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const shareId = event.pathParameters?.shareId;
  if (!shareId) {
    return {
      statusCode: 400,
      headers: { ...PUBLIC_CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Share ID is required.',
        remedy: 'Include the share ID in the URL path.',
      }),
    };
  }

  // Look up the share record
  const shareResult = await client.send(
    new GetCommand({
      TableName: SHARES_TABLE_NAME,
      Key: { shareId },
    }),
  );

  if (!shareResult.Item) {
    return {
      statusCode: 404,
      headers: { ...PUBLIC_CORS_HEADERS },
      body: JSON.stringify({
        code: 'SHARE_NOT_FOUND',
        message: 'This shared note does not exist or has been revoked.',
        remedy: 'Check the URL or contact the note owner for a new link.',
      }),
    };
  }

  const { userId, noteId } = shareResult.Item;

  // Get the actual note
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (!noteResult.Item) {
    return {
      statusCode: 404,
      headers: { ...PUBLIC_CORS_HEADERS },
      body: JSON.stringify({
        code: 'SHARE_NOT_FOUND',
        message: 'This shared note does not exist or has been revoked.',
        remedy: 'Check the URL or contact the note owner for a new link.',
      }),
    };
  }

  // Return only safe fields (privacy: no userId, noteId, tags, isFavorite)
  const { title, content, createdAt, updatedAt } = noteResult.Item;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS_HEADERS },
    body: JSON.stringify({ title, content, createdAt, updatedAt }),
  };
};
