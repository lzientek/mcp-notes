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
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mapInBatches, queryAll } from './helpers/dynamo.js';

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

  // Move the folder's notes back to root. DynamoDB does the filtering, and only
  // the keys come back — the note bodies are not needed to update one attribute.
  const affectedNotes = await queryAll(client, {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: '#folderId = :folderId',
    ExpressionAttributeNames: { '#folderId': 'folderId' },
    ExpressionAttributeValues: { ':uid': userId, ':folderId': folderId },
    ProjectionExpression: 'noteId',
  });

  // BatchWriteItem cannot apply a partial update, and rewriting whole items would
  // clobber concurrent edits — so these are UpdateCommands, just no longer serial.
  const now = new Date().toISOString();
  await mapInBatches(affectedNotes, (note) =>
    client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId, noteId: note.noteId as string },
        UpdateExpression: 'SET #folderId = :null, updatedAt = :now',
        ExpressionAttributeNames: { '#folderId': 'folderId' },
        ExpressionAttributeValues: { ':null': null, ':now': now },
      }),
    ),
  );

  // Delete the folder
  await client.send(
    new DeleteCommand({
      TableName: FOLDERS_TABLE_NAME,
      Key: { userId, folderId },
    }),
  );

  return noContentResponse();
});
