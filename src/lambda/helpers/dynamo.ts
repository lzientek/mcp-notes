import type { DynamoDBDocumentClient, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

/** BatchWriteItem accepts at most 25 requests per call. */
const BATCH_WRITE_MAX_ITEMS = 25;
/** Unprocessed items are a throttling signal, not an error — retry a few times. */
const MAX_UNPROCESSED_RETRIES = 3;
/** Guards against an unbounded pagination loop on a corrupted LastEvaluatedKey. */
const MAX_QUERY_PAGES = 100;
/** How many single-item writes to keep in flight at once. */
const DEFAULT_CONCURRENCY = 25;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WriteRequest =
  | { DeleteRequest: { Key: Record<string, unknown> } }
  | { PutRequest: { Item: Record<string, unknown> } };

/**
 * Sends write requests in batches of 25, retrying whatever DynamoDB reports as
 * unprocessed (a throttling signal rather than a failure).
 */
async function batchWrite(
  client: DynamoDBDocumentClient,
  tableName: string,
  allRequests: WriteRequest[],
): Promise<void> {
  for (const group of chunk(allRequests, BATCH_WRITE_MAX_ITEMS)) {
    let requests = group;

    for (let attempt = 0; attempt <= MAX_UNPROCESSED_RETRIES; attempt += 1) {
      const result = await client.send(
        new BatchWriteCommand({ RequestItems: { [tableName]: requests } }),
      );

      const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
      if (unprocessed.length === 0) break;

      requests = unprocessed as WriteRequest[];
      if (attempt < MAX_UNPROCESSED_RETRIES) {
        await delay(50 * 2 ** attempt);
      }
    }
  }
}

/** Deletes every key in batches of 25 instead of one DeleteCommand per item. */
export async function batchDelete(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
): Promise<void> {
  await batchWrite(
    client,
    tableName,
    keys.map((Key) => ({ DeleteRequest: { Key } })),
  );
}

/** Writes every item in batches of 25 instead of one PutCommand per item. */
export async function batchPut(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
): Promise<void> {
  await batchWrite(
    client,
    tableName,
    items.map((Item) => ({ PutRequest: { Item } })),
  );
}

/**
 * Runs a Query to completion. A FilterExpression is applied after the 1 MB read
 * limit, so a filtered query can return an empty page and still have matches.
 */
export async function queryAll(
  client: DynamoDBDocumentClient,
  input: QueryCommandInput,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  let pages = 0;

  do {
    const result = await client.send(
      new QueryCommand({
        ...input,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    items.push(...(result.Items ?? []));
    startKey = result.LastEvaluatedKey;
    pages += 1;
  } while (startKey && pages < MAX_QUERY_PAGES);

  return items;
}

/**
 * Applies an async operation to every item, a bounded number at a time.
 * Used where BatchWriteItem does not fit: it can only put or delete whole items,
 * never apply a partial update.
 */
export async function mapInBatches<T>(
  items: T[],
  operation: (item: T) => Promise<unknown>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<void> {
  for (const group of chunk(items, concurrency)) {
    await Promise.all(group.map(operation));
  }
}
