import {
  withAuth,
  errorResponse,
  jsonResponse,
  requirePathParam,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;

export const handler = withAuth(async (event, { userId, email }) => {
  const noteId = requirePathParam(event, 'noteId', 'Note ID');

  // Check access: owner or shared recipient
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

  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Number(params.limit) || 20, 100);
  const cursor = params.cursor;

  // Query only activity events (timestamps start with "20" for ISO dates)
  // This naturally excludes diff items which use "diff#" prefix
  const result = await client.send(
    new QueryCommand({
      TableName: ACTIVITY_TABLE_NAME,
      KeyConditionExpression: 'noteId = :nid AND begins_with(#ts, :eventPrefix)',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':nid': noteId, ':eventPrefix': '20' },
      ScanIndexForward: false, // newest first
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: { noteId, timestamp: cursor } } : {}),
    }),
  );

  const events = result.Items ?? [];
  const nextCursor = result.LastEvaluatedKey
    ? (result.LastEvaluatedKey.timestamp as string)
    : null;

  return jsonResponse(200, { events, nextCursor });
});
