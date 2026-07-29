import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

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
    // Check if user is a share recipient
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

  const result = await client.send(
    new QueryCommand({
      TableName: ACTIVITY_TABLE_NAME,
      KeyConditionExpression: 'noteId = :nid',
      ExpressionAttributeValues: { ':nid': noteId },
      ScanIndexForward: false, // newest first
      Limit: limit,
      ...(cursor ? { ExclusiveStartKey: { noteId, timestamp: cursor } } : {}),
    }),
  );

  const events = (result.Items ?? []) as Record<string, unknown>[];
  const nextCursor = result.LastEvaluatedKey
    ? (result.LastEvaluatedKey.timestamp as string)
    : null;

  // Reconcile diffs: for content_updated events with hasDiff, fetch and inline the diff hunks
  const diffTimestamps = events
    .filter((e) => e.action === 'content_updated' && (e.details as Record<string, unknown> | null)?.hasDiff)
    .map((e) => e.timestamp as string);

  if (diffTimestamps.length > 0) {
    const diffKeys = diffTimestamps.map((ts) => ({ noteId, timestamp: `diff#${ts}` }));

    // BatchGet supports up to 100 keys — we're limited to 20 events max, so always safe
    const batchResult = await client.send(
      new BatchGetCommand({
        RequestItems: {
          [ACTIVITY_TABLE_NAME]: { Keys: diffKeys },
        },
      }),
    );

    const diffItems = batchResult.Responses?.[ACTIVITY_TABLE_NAME] ?? [];
    const diffMap = new Map<string, unknown>();
    for (const item of diffItems) {
      // Key is "diff#<original_timestamp>" → extract original timestamp
      const originalTs = (item.timestamp as string).replace(/^diff#/, '');
      diffMap.set(originalTs, item.hunks);
    }

    // Merge hunks into events
    for (const evt of events) {
      const hunks = diffMap.get(evt.timestamp as string);
      if (hunks) {
        (evt as Record<string, unknown>).diff = hunks;
      }
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ events, nextCursor }),
  };
};
