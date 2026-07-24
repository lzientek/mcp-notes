import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CORS_HEADERS } from './helpers/cors.js';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
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

  const params = event.queryStringParameters ?? {};
  const limit = Math.min(Number(params.limit) || 20, 100);
  const cursor = params.cursor;
  const searchQuery = params.search?.toLowerCase();
  const tagsFilter = params.tags ? params.tags.split(',').map((t) => t.trim().toLowerCase()) : null;
  const fromDate = params.from ?? null;
  const toDate = params.to ?? null;
  const favoritesOnly = params.favorites === 'true';

  // Build query — we always query by userId (partition key)
  // Filtering is done in-memory after query since DynamoDB filter expressions
  // on lists and contains are limited. For a personal notes app (<1000 notes), this is fine.
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ...(cursor ? { ExclusiveStartKey: { userId, noteId: cursor } } : {}),
    }),
  );

  let notes = result.Items ?? [];

  // Apply filters in-memory
  if (tagsFilter && tagsFilter.length > 0) {
    notes = notes.filter((note) => {
      const noteTags = (note.tags as string[] | undefined) ?? [];
      return tagsFilter.some((tag) => noteTags.includes(tag));
    });
  }

  if (fromDate) {
    notes = notes.filter((note) => (note.createdAt as string) >= fromDate);
  }

  if (toDate) {
    // Add end-of-day to make "to" inclusive
    const toEnd = toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
    notes = notes.filter((note) => (note.createdAt as string) <= toEnd);
  }

  if (searchQuery) {
    notes = notes.filter((note) => {
      const title = ((note.title as string) ?? '').toLowerCase();
      const content = ((note.content as string) ?? '').toLowerCase();
      return title.includes(searchQuery) || content.includes(searchQuery);
    });
  }

  if (favoritesOnly) {
    notes = notes.filter((note) => note.isFavorite === true);
  }

  // Sort by updatedAt descending
  notes.sort((a, b) =>
    (b.updatedAt as string).localeCompare(a.updatedAt as string),
  );

  // Paginate
  const paginatedNotes = notes.slice(0, limit);
  const nextCursor =
    paginatedNotes.length === limit && notes.length > limit
      ? (paginatedNotes[paginatedNotes.length - 1].noteId as string)
      : null;

  // Ensure isFavorite field (retrocompat)
  const output = paginatedNotes.map((note) => ({
    ...note,
    isFavorite: note.isFavorite ?? false,
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ notes: output, nextCursor }),
  };
};
