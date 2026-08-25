import {
  withAuth,
  errorResponse,
  jsonResponse,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId, email }) => {
  const noteId = event.pathParameters?.noteId;
  const params = event.queryStringParameters ?? {};
  const timestamp = params.timestamp;

  if (!noteId || !timestamp) {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'noteId and timestamp query parameter are required.',
      remedy: 'Include noteId in the path and timestamp as a query parameter.',
    });
  }

  // Access check: owner or shared recipient
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  let hasAccess = !!noteResult.Item;

  if (!hasAccess) {
        if (email) {
      const sharesResult = await client.send(
        new QueryCommand({
          TableName: SHARES_TABLE_NAME,
          IndexName: 'NoteIdIndex',
          KeyConditionExpression: 'noteId = :nid',
          ExpressionAttributeValues: { ':nid': noteId },
        }),
      );
      hasAccess = (sharesResult.Items ?? []).some(
        (item) => item.recipientEmail === email,
      );
    }
  }

  if (!hasAccess) {
    return errorResponse(404, {
      code: 'NOTE_NOT_FOUND',
      message: 'The requested note was not found.',
      remedy: 'Verify the note ID and try again.',
    });
  }

  // Fetch the diff item
  const result = await client.send(
    new GetCommand({
      TableName: ACTIVITY_TABLE_NAME,
      Key: { noteId, timestamp: `diff#${timestamp}` },
    }),
  );

  if (!result.Item) {
    return errorResponse(404, {
      code: 'DIFF_NOT_FOUND',
      message: 'Diff not found or expired (diffs are kept for 30 days).',
      remedy: 'The diff may have expired. Only the last 30 days of diffs are available.',
    });
  }

  return jsonResponse(200, { hunks: result.Item.hunks });
});
