import {
  errorResponse,
  jsonResponse,
  requirePathParam,
  withErrorHandling,
} from './helpers/http.js';
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

export const handler = withErrorHandling(async (event) => {
  const shareId = requirePathParam(event, 'shareId', 'Share ID');

  // Look up the share record
  const shareResult = await client.send(
    new GetCommand({
      TableName: SHARES_TABLE_NAME,
      Key: { shareId },
    }),
  );

  if (!shareResult.Item) {
    return errorResponse(404, {
      code: 'SHARE_NOT_FOUND',
      message: 'This shared note does not exist or has been revoked.',
      remedy: 'Check the URL or contact the note owner for a new link.',
    }, PUBLIC_CORS_HEADERS);
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
    return errorResponse(404, {
      code: 'SHARE_NOT_FOUND',
      message: 'This shared note does not exist or has been revoked.',
      remedy: 'Check the URL or contact the note owner for a new link.',
    }, PUBLIC_CORS_HEADERS);
  }

  // Return only safe fields (privacy: no userId, noteId, tags, isFavorite)
  const { title, content, createdAt, updatedAt } = noteResult.Item;

  return jsonResponse(200, { title, content, createdAt, updatedAt }, PUBLIC_CORS_HEADERS);
}, PUBLIC_CORS_HEADERS);
