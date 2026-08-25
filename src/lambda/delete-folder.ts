import {
  withAuth,
  errorResponse,
  noContentResponse,
  requirePathParam,
} from './helpers/http.js';
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

export const handler = withAuth(async (event, { userId }) => {
  const folderId = requirePathParam(event, 'folderId', 'Folder ID');

  // Verify the folder exists and belongs to the user
  const folderResult = await client.send(
    new GetCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { userId, folderId },
    }),
  );

  if (!folderResult.Item) {
    return errorResponse(404, {
      code: 'FOLDER_NOT_FOUND',
      message: 'The requested folder was not found.',
      remedy: 'Verify the folder ID and try again.',
    });
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

  return noContentResponse();
});
