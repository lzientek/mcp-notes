import {
  withAuth,
  errorResponse,
  jsonResponse,
  requirePathParam,
  parseBody,
} from './helpers/http.js';
import { generateShareId } from './helpers/share-id.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const SHARES_TABLE_NAME = process.env.SHARES_TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

interface ShareNoteBody {
  type?: string;
  email?: string;
  permission?: string;
}

export const handler = withAuth(async (event, { userId }) => {
  const noteId = requirePathParam(event, 'noteId', 'Note ID');

  const body = parseBody<ShareNoteBody>(
    event,
    'Send a JSON object with a type field ("public" or "user").',
  );

  const { type, email } = body;
  let permission = body.permission ?? 'read';

  // Validate type
  if (type !== 'public' && type !== 'user') {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Type must be "public" or "user".',
      remedy: 'Set type to "public" for a public link or "user" for a user share.',
    });
  }

  // Validate email for user shares
  if (type === 'user') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse(400, {
        code: 'INVALID_REQUEST',
        message: 'A valid email address is required for user shares.',
        remedy: 'Provide a valid email in the request body.',
      });
    }
  }

  // Validate permission
  if (permission !== 'read' && permission !== 'write') {
    return errorResponse(400, {
      code: 'INVALID_REQUEST',
      message: 'Permission must be "read" or "write".',
      remedy: 'Set permission to "read" or "write".',
    });
  }

  // Force read-only for public shares
  if (type === 'public') {
    permission = 'read';
  }

  // Verify note exists and caller is the owner
  const noteResult = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, noteId },
    }),
  );

  if (!noteResult.Item) {
    return errorResponse(404, {
      code: 'NOTE_NOT_FOUND',
      message: 'The requested note was not found.',
      remedy: 'Verify the note ID and ensure you own this note.',
    });
  }

  // Query existing shares for this note
  const existingShares = await client.send(
    new QueryCommand({
      TableName: SHARES_TABLE_NAME,
      IndexName: 'NoteIdIndex',
      KeyConditionExpression: 'noteId = :nid',
      ExpressionAttributeValues: { ':nid': noteId },
    }),
  );

  const shares = existingShares.Items ?? [];

  if (type === 'public') {
    // Check if a public share already exists
    const existingPublic = shares.find((s) => s.type === 'public');
    if (existingPublic) {
      return jsonResponse(200, {
        shareId: existingPublic.shareId,
        shareUrl: `${FRONTEND_URL}/shared/${existingPublic.shareId}`,
        type: 'public',
        permission: 'read',
      });
    }

    // Create new public share
    const shareId = generateShareId();
    const now = new Date().toISOString();

    await client.send(
      new PutCommand({
        TableName: SHARES_TABLE_NAME,
        Item: {
          shareId,
          userId,
          noteId,
          type: 'public',
          permission: 'read',
          createdAt: now,
        },
      }),
    );

    return jsonResponse(201, {
      shareId,
      shareUrl: `${FRONTEND_URL}/shared/${shareId}`,
      type: 'public',
      permission: 'read',
    });
  }

  // type === 'user'
  const existingUserShare = shares.find(
    (s) => s.type === 'user' && s.recipientEmail === email,
  );

  const now = new Date().toISOString();

  if (existingUserShare) {
    // Update permission if different
    if (existingUserShare.permission !== permission) {
      await client.send(
        new PutCommand({
          TableName: SHARES_TABLE_NAME,
          Item: {
            ...existingUserShare,
            permission,
          },
        }),
      );
    }

    return jsonResponse(200, {
      shareId: existingUserShare.shareId,
      type: 'user',
      email,
      permission,
      createdAt: existingUserShare.createdAt,
    });
  }

  // Create new user share
  const shareId = generateShareId();

  await client.send(
    new PutCommand({
      TableName: SHARES_TABLE_NAME,
      Item: {
        shareId,
        userId,
        noteId,
        type: 'user',
        permission,
        recipientEmail: email,
        createdAt: now,
      },
    }),
  );

  return jsonResponse(201, {
    shareId,
    type: 'user',
    email,
    permission,
    createdAt: now,
  });
});
