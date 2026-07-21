import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
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

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
        remedy: 'Ensure your request includes a valid authorization token.',
      }),
    };
  }

  const tagId = event.pathParameters?.tagId;
  if (!tagId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'INVALID_REQUEST',
        message: 'Tag ID is required.',
        remedy: 'Include the tag ID in the URL path.',
      }),
    };
  }

  // Get the tag to retrieve its name
  const tagResult = await client.send(
    new GetCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  if (!tagResult.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        code: 'TAG_NOT_FOUND',
        message: 'The requested tag was not found.',
        remedy: 'Verify the tag ID and try again.',
      }),
    };
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

  return {
    statusCode: 204,
    body: '',
  };
};
