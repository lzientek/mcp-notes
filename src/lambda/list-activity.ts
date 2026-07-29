import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITY_TABLE_NAME = process.env.ACTIVITY_TABLE_NAME!;
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

  // Check access: owner or shared recipient
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  let hasAccess = !!noteResult.Item;

  if (!hasAccess) {
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
      hasAccess = (sharesResult.Items ?? []).some(
        (item) => item.recipientEmail === callerEmail,
      );
    }
  }

  if (!hasAccess) {
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

  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Number(params.limit) || 20, 100);
  const cursor = params.cursor;

  // Fetch all items (events + diffs) from the partition
  const result = await client.send(
    new QueryCommand({
      TableName: ACTIVITY_TABLE_NAME,
      KeyConditionExpression: 'noteId = :nid',
      ExpressionAttributeValues: { ':nid': noteId },
      ScanIndexForward: false, // newest first
      Limit: limit * 2, // fetch extra to account for diff items mixed in
      ...(cursor ? { ExclusiveStartKey: { noteId, timestamp: cursor } } : {}),
    }),
  );

  const allItems = (result.Items ?? []) as Record<string, unknown>[];

  // Separate diff items from activity events
  const diffMap = new Map<string, unknown>();
  const events: Record<string, unknown>[] = [];

  for (const item of allItems) {
    const ts = item.timestamp as string;
    if (ts.startsWith('diff#')) {
      const originalTs = ts.replace(/^diff#/, '');
      diffMap.set(originalTs, item.hunks);
    } else {
      events.push(item);
    }
  }

  // Reconcile: inline diff hunks into their corresponding content_updated events
  for (const evt of events) {
    const hunks = diffMap.get(evt.timestamp as string);
    if (hunks) {
      evt.diff = hunks;
    }
  }

  // Apply the requested limit (we fetched extra to account for diff items)
  const trimmedEvents = events.slice(0, limit);

  // Compute cursor from the last event actually returned
  const nextCursor = trimmedEvents.length >= limit && result.LastEvaluatedKey
    ? (trimmedEvents[trimmedEvents.length - 1].timestamp as string)
    : null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ events: trimmedEvents, nextCursor }),
  };
};
