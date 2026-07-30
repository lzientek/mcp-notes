import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

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

  // Try owner path first
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (result.Item) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ ...result.Item, isFavorite: result.Item.isFavorite ?? false }),
    };
  }

  // Not found as owner — check if caller is a share recipient
  const callerEmail = event.requestContext.authorizer?.claims?.email;
  if (callerEmail) {
    const sharesResult = await client.send(
      new QueryCommand({
        TableName: SHARES_TABLE_NAME,
        IndexName: 'NoteIdIndex',
        KeyConditionExpression: 'noteId = :nid',
        ExpressionAttributeValues: { ':nid': noteId },
      }),
    );

    const shareRecord = (sharesResult.Items ?? []).find(
      (item) => item.recipientEmail === callerEmail,
    );

    if (shareRecord) {
      const ownerUserId = shareRecord.userId as string;
      const noteResult = await client.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: ownerUserId, noteId },
        }),
      );

      if (noteResult.Item) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({
            ...noteResult.Item,
            isFavorite: noteResult.Item.isFavorite ?? false,
            isShared: true,
            permission: shareRecord.permission,
          }),
        };
      }
    }
  }

  return {
    statusCode: 404,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify({
      code: 'NOTE_NOT_FOUND',
      message: 'The requested note was not found.',
      remedy: 'Verify the note ID and try again.',
    }),
  };
};
