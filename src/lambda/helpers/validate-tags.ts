import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';

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

  const normalizedNames = tagNames.map((n) => n.toLowerCase());

  // Direct key lookups — tagId IS the name
  const keys = normalizedNames.map((name) => ({ userId, tagId: name }));

  // BatchGetItem (max 100 keys per call, fine for tags)
  const result = await client.send(
    new BatchGetCommand({
      RequestItems: {
        [tagsTableName]: { Keys: keys },
      },
    }),
  );

  const foundNames = new Set(
    (result.Responses?.[tagsTableName] ?? []).map((item) => item.tagId as string),
  );

  const invalidTags = normalizedNames.filter((name) => !foundNames.has(name));

  if (invalidTags.length > 0) {
    return { valid: false, invalidTags };
  }

  return { valid: true };
}
