import { withAuth, jsonResponse } from './helpers/http.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;

export const handler = withAuth(async (_event, { userId }) => {
  const result = await client.send(
    new QueryCommand({
      TableName: FOLDERS_TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const folders = (result.Items ?? []).sort((a, b) =>
    (a.name as string).localeCompare(b.name as string),
  );

  return jsonResponse(200, { folders });
});
