import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: ESM imports are evaluated before top-level statements, so the handler
// would otherwise read whatever TABLE_NAME another test file left behind.
vi.hoisted(() => {
  process.env.TABLE_NAME = 'NotesTable';
  process.env.SHARES_TABLE_NAME = 'SharesTable';
});

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: class { readonly type = 'Query'; constructor(public input: any) {} },
  BatchWriteCommand: class { readonly type = 'BatchWrite'; constructor(public input: any) {} },
}));

import { handler } from '../../../src/lambda/bulk-delete-notes.js';

function makeEvent(body: unknown, userId: string | null = 'user-123') {
  return {
    requestContext: { authorizer: { claims: userId ? { sub: userId } : {} } },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as any;
}

function commandsOfType(type: string) {
  return mockSend.mock.calls.map((c) => c[0]).filter((c) => c.type === type);
}

describe('bulk-delete-notes handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('returns 401 without a userId', async () => {
    const res = await handler(makeEvent({ noteIds: ['n1'] }, null));
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty noteIds array', async () => {
    const res = await handler(makeEvent({ noteIds: [] }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects more than 50 notes', async () => {
    const noteIds = Array.from({ length: 51 }, (_, i) => `n${i}`);
    const res = await handler(makeEvent({ noteIds }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed body', async () => {
    const res = await handler(makeEvent('{not json'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
  });

  it('deletes notes in BatchWrite groups of 25 rather than one call each', async () => {
    const noteIds = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const res = await handler(makeEvent({ noteIds }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).deleted).toBe(30);

    const batches = commandsOfType('BatchWrite');
    expect(batches).toHaveLength(2);
    expect(batches[0].input.RequestItems.NotesTable).toHaveLength(25);
    expect(batches[1].input.RequestItems.NotesTable).toHaveLength(5);
    expect(batches[0].input.RequestItems.NotesTable[0]).toEqual({
      DeleteRequest: { Key: { userId: 'user-123', noteId: 'n0' } },
    });
  });

  it('cascades share deletion through the NoteIdIndex', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return { Items: [{ shareId: `share-for-${cmd.input.ExpressionAttributeValues[':nid']}` }] };
      }
      return {};
    });

    await handler(makeEvent({ noteIds: ['n1', 'n2'] }));

    const shareBatch = commandsOfType('BatchWrite').find(
      (c) => c.input.RequestItems.SharesTable,
    );
    expect(shareBatch.input.RequestItems.SharesTable).toEqual([
      { DeleteRequest: { Key: { shareId: 'share-for-n1' } } },
      { DeleteRequest: { Key: { shareId: 'share-for-n2' } } },
    ]);
  });

  it('retries whatever DynamoDB reports as unprocessed', async () => {
    let call = 0;
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type !== 'BatchWrite') return { Items: [] };
      call += 1;
      if (call === 1) {
        return {
          UnprocessedItems: {
            NotesTable: [{ DeleteRequest: { Key: { userId: 'user-123', noteId: 'n1' } } }],
          },
        };
      }
      return {};
    });

    await handler(makeEvent({ noteIds: ['n1'] }));
    expect(commandsOfType('BatchWrite')).toHaveLength(2);
  });
});
