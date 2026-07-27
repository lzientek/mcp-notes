import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './helpers/cors.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { validateTags } from './helpers/validate-tags.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;
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

  let body: { title?: string; content?: string; tags?: string[]; folderId?: string | null; isFavorite?: boolean; source?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Request body must be valid JSON.',
        remedy: 'Send a JSON object with title and/or content fields.',
      }),
    };
  }

  // Try to get the note with caller's userId (owner path)
  const existing = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  let isOwner = true;
  let note = existing.Item;
  let sharePermission: string | null = null;

  // If note not found with caller's userId, check if caller is a recipient
  if (!note) {
    isOwner = false;
    const callerEmail = event.requestContext.authorizer?.claims?.email;

    if (!callerEmail) {
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

    // Query Shares table GSI1 (NoteIdIndex) by noteId, filter by recipientEmail
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

    if (!shareRecord) {
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

    sharePermission = shareRecord.permission as string;

    // Check permission level
    if (sharePermission === 'read') {
      return {
        statusCode: 403,
        headers: { ...CORS_HEADERS },
        body: JSON.stringify({
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You only have read access to this note.',
          remedy: 'Contact the note owner to request write access.',
        }),
      };
    }

    // permission === 'write': fetch the actual note using the owner's userId
    const ownerUserId = shareRecord.userId as string;
    const noteResult = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId: ownerUserId, noteId },
      }),
    );

    note = noteResult.Item;
    if (!note) {
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
  }

  // For write-recipients, reject isFavorite changes
  if (!isOwner && body.isFavorite !== undefined) {
    return {
      statusCode: 403,
      headers: { ...CORS_HEADERS },
      body: JSON.stringify({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You cannot change the favorite status of a shared note.',
        remedy: 'Only the note owner can modify the favorite status.',
      }),
    };
  }

  // Validate tags if provided
  const noteOwnerUserId = note.userId as string;
  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    tags = body.tags.map((t) => t.toLowerCase());
    if (tags.length > 0) {
      const validation = await validateTags(client, TAGS_TABLE_NAME, noteOwnerUserId, tags);
      if (!validation.valid) {
        return {
          statusCode: 400,
          headers: { ...CORS_HEADERS },
          body: JSON.stringify({
            code: 'INVALID_TAGS',
            message: 'Some tags do not exist.',
            invalidTags: validation.invalidTags,
          }),
        };
      }
    }
  }

  const updatedNote = {
    ...note,
    title: body.title ?? note.title,
    content: body.content ?? note.content,
    tags: tags !== undefined ? tags : (note.tags ?? []),
    folderId: body.folderId !== undefined ? body.folderId : (note.folderId ?? null),
    isFavorite: isOwner
      ? (body.isFavorite !== undefined ? body.isFavorite : (note.isFavorite ?? false))
      : (note.isFavorite ?? false),
    lastModifiedBy: body.source ?? note.lastModifiedBy ?? null,
    lastModifiedByUser: event.requestContext.authorizer?.claims?.email ?? userId,
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedNote,
      ConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': noteOwnerUserId },
    }),
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(updatedNote),
  };
};
