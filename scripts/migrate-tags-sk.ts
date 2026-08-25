/**
 * Migration script: change tags SK from ULID to tag name.
 * For each tag item with a ULID-based tagId, creates a new item with tagId=name
 * and deletes the old item.
 *
 * Usage: npx tsx scripts/migrate-tags-sk.ts --profile mcp-notes
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const TAGS_TABLE_NAME = 'McpNotesStack-McpNotesTagsTableB80CCCBA-76P1K18CWPFM';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' }));

async function migrate() {
  console.log('Scanning tags table...');

  const result = await client.send(
    new ScanCommand({ TableName: TAGS_TABLE_NAME }),
  );

  const items = (result.Items ?? []).map((item) => unmarshall(item));
  console.log(`Found ${items.length} tags`);

  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    const userId = item.userId as string;
    const tagId = item.tagId as string;
    const name = (item.name as string).toLowerCase();

    // If tagId is already the name, skip
    if (tagId === name) {
      skipped++;
      continue;
    }

    // Create new item with name as SK
    await client.send(
      new PutCommand({
        TableName: TAGS_TABLE_NAME,
        Item: {
          userId,
          tagId: name,
          name,
          createdAt: item.createdAt as string,
        },
        ConditionExpression: 'attribute_not_exists(tagId)',
      }),
    ).catch(() => {
      // Already exists — fine
    });

    // Delete old item
    await client.send(
      new DeleteCommand({
        TableName: TAGS_TABLE_NAME,
        Key: { userId, tagId },
      }),
    );

    migrated++;
    console.log(`  Migrated: ${userId} / ${tagId} → ${name}`);
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped (already migrated): ${skipped}`);
}

migrate().catch(console.error);
