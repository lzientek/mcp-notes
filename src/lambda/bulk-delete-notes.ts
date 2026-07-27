import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

  let body: { noteIds?: string[] };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with a noteIds array.',
      }),
    };
  }

  const noteIds = body.noteIds;
  if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'noteIds array is required and must not be empty.',
        remedy: 'Provide a non-empty noteIds array (max 50 items).',
      }),
    };
  }

  if (noteIds.length > 50) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Cannot delete more than 50 notes at once.',
        remedy: 'Reduce the noteIds array to 50 items or fewer.',
      }),
    };
  }

  // Delete each note and cascade delete shares
  for (const noteId of noteIds) {
    // Delete the note
    await client.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId, noteId },
      }),
    );

    // Cascade delete all share records for this note
    const sharesResult = await client.send(
      new QueryCommand({
        TableName: SHARES_TABLE_NAME,
        IndexName: 'NoteIdIndex',
        KeyConditionExpression: 'noteId = :nid',
        ExpressionAttributeValues: { ':nid': noteId },
      }),
    );

    const shares = sharesResult.Items ?? [];
    for (const share of shares) {
      await client.send(
        new DeleteCommand({
          TableName: SHARES_TABLE_NAME,
          Key: { shareId: share.shareId as string },
        }),
      );
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ deleted: noteIds.length }),
  };
};
