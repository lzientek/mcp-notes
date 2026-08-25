import { withAuth, jsonResponse } from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;

export const handler = withAuth(async (_event, { userId }) => {
  const result = await client.send(
    new QueryCommand({
      TableName: TAGS_TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const tags = (result.Items ?? []).toSorted((a, b) =>
    (a.name as string).localeCompare(b.name as string),
  );

  return jsonResponse(200, { tags });
});
