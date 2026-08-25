import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.ACTIVITY_TABLE_NAME = 'ActivityTable';
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

import { handler } from '../../../src/lambda/process-note-stream.js';

/** Minimal DynamoDB stream record — only the attributes the handler reads. */
function record(eventName: string, oldImage: any, newImage: any) {
  const marshal = (obj: any) =>
    obj === null
      ? undefined
      : Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [
            k,
            typeof v === 'boolean'
              ? { BOOL: v }
              : Array.isArray(v)
                ? { L: (v as string[]).map((s) => ({ S: s })) }
                : v === null
                  ? { NULL: true }
                  : { S: v as string },
          ]),
        );
  return {
    eventName,
    // The real service sends a stable eventID; retries of a record reuse it.
    eventID: `evt-${eventName}-${String((newImage ?? oldImage)?.noteId ?? 'x')}`,
    dynamodb: { OldImage: marshal(oldImage), NewImage: marshal(newImage) },
  };
}

function writtenItems() {
  return mockSend.mock.calls
    .map((c) => c[0])
    .filter((c) => c.type === 'BatchWrite')
    .flatMap((c) => c.input.RequestItems.ActivityTable);
}

function commandsOfType(type: string) {
  return mockSend.mock.calls.map((c) => c[0]).filter((c) => c.type === type);
}

const base = {
  noteId: 'note-1',
  userId: 'user-1',
  title: 'Title',
  content: 'line one',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

describe('process-note-stream handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('records a creation event on INSERT', async () => {
    await handler({ Records: [record('INSERT', null, base)] } as any);

    const items = writtenItems();
    expect(items).toHaveLength(1);
    expect(items[0].PutRequest.Item.action).toBe('note_created');
    expect(items[0].PutRequest.Item.noteId).toBe('note-1');
    expect(items[0].PutRequest.Item.ttl).toBeGreaterThan(0);
  });

  it('detects a title change and a content change with its diff', async () => {
    await handler({
      Records: [
        record('MODIFY', base, { ...base, title: 'New title', content: 'line two' }),
      ],
    } as any);

    const items = writtenItems().map((i: any) => i.PutRequest.Item);
    expect(items.map((i: any) => i.action)).toContain('title_changed');
    expect(items.map((i: any) => i.action)).toContain('content_updated');
    const diff = items.find((i: any) => String(i.timestamp).startsWith('diff#'));
    expect(diff).toBeDefined();
    expect(diff.hunks).toBeDefined();
  });

  it('ignores REMOVE records', async () => {
    await handler({ Records: [record('REMOVE', base, null)] } as any);
    expect(writtenItems()).toHaveLength(0);
  });

  it('writes the whole batch in one BatchWrite call', async () => {
    await handler({
      Records: [
        record('INSERT', null, base),
        record('INSERT', null, { ...base, noteId: 'note-2' }),
        record('INSERT', null, { ...base, noteId: 'note-3' }),
      ],
    } as any);

    expect(commandsOfType('BatchWrite')).toHaveLength(1);
    expect(writtenItems()).toHaveLength(3);
  });

  it('purges once per note even when a batch touches it repeatedly', async () => {
    await handler({
      Records: [
        record('MODIFY', base, { ...base, title: 'a' }),
        record('MODIFY', base, { ...base, title: 'b' }),
        record('MODIFY', base, { ...base, noteId: 'note-2', title: 'c' }),
      ],
    } as any);

    // note-1 twice + note-2 once, but only two purge queries
    expect(commandsOfType('Query')).toHaveLength(2);
  });

  it('bounds the purge read and excludes diff items from the count', async () => {
    await handler({ Records: [record('INSERT', null, base)] } as any);

    const query = commandsOfType('Query')[0];
    // cap + one purge batch: a window of cap + 1 could only ever delete one
    // event, while a single save can emit five
    expect(query.input.Limit).toBe(300);
    expect(query.input.ScanIndexForward).toBe(true);
    expect(query.input.KeyConditionExpression).toContain('begins_with(#ts, :eventPrefix)');
    expect(query.input.ExpressionAttributeValues[':eventPrefix']).toBe('20');
    expect(query.input.ProjectionExpression).toBe('noteId, #ts');
  });

  it('deletes the whole overflow, not just one event', async () => {
    const stored = Array.from({ length: 250 }, (_, i) => ({
      noteId: 'note-1',
      timestamp: `2026-01-01T00:00:${String(i).padStart(4, '0')}Z#x`,
    }));
    mockSend.mockImplementation(async (cmd: any) =>
      cmd.type === 'Query' ? { Items: stored } : {},
    );

    await handler({ Records: [record('INSERT', null, base)] } as any);

    const deletes = mockSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c.type === 'BatchWrite')
      .flatMap((c) => c.input.RequestItems.ActivityTable)
      .filter((r: any) => r.DeleteRequest);
    expect(deletes).toHaveLength(50); // 250 stored - 200 cap
    expect(deletes[0].DeleteRequest.Key.timestamp).toBe(stored[0].timestamp);
    expect(deletes[49].DeleteRequest.Key.timestamp).toBe(stored[49].timestamp);
  });

  it('writes the same sort keys when a record is retried', async () => {
    const streamEvent = { Records: [record('INSERT', null, base)] } as any;

    await handler(streamEvent);
    const first = writtenItems().map((i: any) => i.PutRequest.Item.timestamp);

    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: [] });
    await handler(streamEvent);
    const second = writtenItems().map((i: any) => i.PutRequest.Item.timestamp);

    // A random suffix would duplicate the event on the retry Lambda performs
    // after a partial batch failure; these must overwrite instead.
    expect(second).toEqual(first);
  });

  it('gives each event of one record its own key', async () => {
    await handler({
      Records: [
        record('MODIFY', base, { ...base, title: 'New', content: 'other', isFavorite: true }),
      ],
    } as any);

    const timestamps = writtenItems().map((i: any) => i.PutRequest.Item.timestamp);
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('keys the diff item off the event it belongs to', async () => {
    await handler({
      Records: [record('MODIFY', base, { ...base, content: 'changed' })],
    } as any);

    const items = writtenItems().map((i: any) => i.PutRequest.Item);
    const event = items.find((i: any) => i.action === 'content_updated');
    const diff = items.find((i: any) => String(i.timestamp).startsWith('diff#'));
    expect(diff.timestamp).toBe(`diff#${event.timestamp}`);
  });

  it('lets a write failure surface so Lambda retries and the DLQ catches it', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'BatchWrite') throw new Error('ProvisionedThroughputExceeded');
      return { Items: [] };
    });

    await expect(
      handler({ Records: [record('INSERT', null, base)] } as any),
    ).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  it('keeps processing after one malformed record', async () => {
    const broken = { eventName: 'MODIFY', dynamodb: { OldImage: { bad: {} }, NewImage: { bad: {} } } };
    await handler({ Records: [broken, record('INSERT', null, base)] } as any);
    expect(writtenItems().length).toBeGreaterThanOrEqual(1);
  });
});
