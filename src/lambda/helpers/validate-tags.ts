import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface ValidateTagsResult {
  valid: boolean;
  invalidTags?: string[];
}

export async function validateTags(
  client: DynamoDBDocumentClient,
  tagsTableName: string,
  userId: string,
  tagNames: string[],
): Promise<ValidateTagsResult> {
  if (tagNames.length === 0) {
    return { valid: true };
  }

  const result = await client.send(
    new QueryCommand({
      TableName: tagsTableName,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const existingNames = new Set(
    (result.Items ?? []).map((item) => item.name as string),
  );

  const invalidTags = tagNames.filter(
    (name) => !existingNames.has(name.toLowerCase()),
  );

  if (invalidTags.length > 0) {
    return { valid: false, invalidTags };
  }

  return { valid: true };
}
