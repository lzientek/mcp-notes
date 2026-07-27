import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

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

  const folderId = event.pathParameters?.folderId;
  if (!folderId) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Folder ID is required.',
        remedy: 'Include the folder ID in the URL path.',
      }),
    };
  }

  // Verify the folder exists and belongs to the user
  const folderResult = await client.send(
    new GetCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { userId, folderId },
    }),
  );

  if (!folderResult.Item) {
    return {
      statusCode: 404,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'FOLDER_NOT_FOUND',
        message: 'The requested folder was not found.',
        remedy: 'Verify the folder ID and try again.',
      }),
    };
  }

  // Move all notes in this folder back to root (set folderId to null)
  const notesResult = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const affectedNotes = (notesResult.Items ?? []).filter(
    (note) => note.folderId === folderId,
  );

  for (const note of affectedNotes) {
    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...note,
          folderId: null,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  }

  // Delete the folder
  await client.send(
    new DeleteCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { userId, folderId },
    }),
  );

  return {
    statusCode: 204,
    headers: { ...CORS_HEADERS },
    body: '',
  };
};
