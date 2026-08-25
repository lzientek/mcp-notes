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
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = withAuth(async (event, { userId }) => {
  const tagId = requirePathParam(event, 'tagId', 'Tag ID');

  // Get the tag to retrieve its name
  const tagResult = await client.send(
    new GetCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  if (!tagResult.Item) {
    return errorResponse(404, {
      code: 'TAG_NOT_FOUND',
      message: 'The requested tag was not found.',
      remedy: 'Verify the tag ID and try again.',
    });
  }

  const tagName = tagResult.Item.name as string;

  // Cascade: remove tag name from all user notes that reference it
  const notesResult = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const affectedNotes = (notesResult.Items ?? []).filter((note) => {
    const tags = note.tags as string[] | undefined;
    return tags && tags.includes(tagName);
  });

  // Update each affected note to remove the tag
  for (const note of affectedNotes) {
    const currentTags = note.tags as string[];
    const updatedTags = currentTags.filter((t) => t !== tagName);

    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...note,
          tags: updatedTags,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  }

  // Delete the tag
  await client.send(
    new DeleteCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  return noContentResponse();
});
