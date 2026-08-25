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

  // Cascade: strip the tag from every note that carries it. DynamoDB does the
  // matching and returns only what is needed to build the update.
  const affectedNotes = await queryAll(client, {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: 'contains(#tags, :tagName)',
    ExpressionAttributeNames: { '#tags': 'tags' },
    ExpressionAttributeValues: { ':uid': userId, ':tagName': tagName },
    ProjectionExpression: 'noteId, #tags',
  });

  // REMOVE #tags[i] rewrites one list element instead of the whole note. The
  // condition makes the index safe: if a concurrent edit shifted the list, the
  // update fails rather than dropping the wrong tag.
  const now = new Date().toISOString();
  await mapInBatches(affectedNotes, async (note) => {
    const tags = (note.tags as string[] | undefined) ?? [];
    const index = tags.indexOf(tagName);
    if (index === -1) return;

    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { userId, noteId: note.noteId as string },
          UpdateExpression: `REMOVE #tags[${index}] SET updatedAt = :now`,
          ConditionExpression: `#tags[${index}] = :tagName`,
          ExpressionAttributeNames: { '#tags': 'tags' },
          ExpressionAttributeValues: { ':tagName': tagName, ':now': now },
        }),
      );
    } catch (err) {
      // The note changed under us; the tag is gone or moved, nothing to repair.
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
        throw err;
      }
    }
  });

  // Delete the tag
  await client.send(
    new DeleteCommand({
      TableName: TAGS_TABLE_NAME,
      Key: { userId, tagId },
    }),
  );

  return noContentResponse();
});
