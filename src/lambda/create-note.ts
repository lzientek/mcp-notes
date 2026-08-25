import {
  withAuth,
  errorResponse,
  jsonResponse,
  parseBody,
  NOTE_BODY_LIMIT,
} from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { validateTags } from './helpers/validate-tags.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;

interface CreateNoteBody {
  title?: string;
  content?: string;
  tags?: string[];
  isFavorite?: boolean;
  source?: string;
}

export const handler = withAuth(async (event, { userId, email }) => {
  const body = parseBody<CreateNoteBody>(
    event,
    'Send a JSON object with title and content fields.',
    NOTE_BODY_LIMIT,
  );

  const title = body.title ?? 'Untitled';
  const content = body.content ?? '';
  const tags = body.tags ?? [];
  const isFavorite = body.isFavorite ?? false;
  const source = body.source ?? null;

  // Validate tags if provided
  if (tags.length > 0) {
    const validation = await validateTags(client, TAGS_TABLE_NAME, userId, tags);
    if (!validation.valid) {
      return errorResponse(400, {
        code: 'INVALID_TAGS',
        message: 'Some tags do not exist.',
        invalidTags: validation.invalidTags,
      });
    }
  }

  const now = new Date().toISOString();
  const noteId = ulid();

  const note = {
    userId,
    noteId,
    title,
    content,
    tags: tags.map((t) => t.toLowerCase()),
    isFavorite,
    lastModifiedBy: source,
    lastModifiedByUser: email ?? userId,
    createdAt: now,
    updatedAt: now,
  };

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: note,
    }),
  );

  return jsonResponse(201, note);
});
