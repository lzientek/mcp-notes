import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME!;

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

  const result = await client.send(
    new QueryCommand({
      TableName: TAGS_TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const tags = (result.Items ?? []).sort((a, b) =>
    (a.name as string).localeCompare(b.name as string),
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  };
};
