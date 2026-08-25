import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  BatchWriteCommand: class { readonly type = 'BatchWrite'; constructor(public input: any) {} },
  QueryCommand: class { readonly type = 'Query'; constructor(public input: any) {} },
}));

import { batchDelete, batchPut, chunk, mapInBatches, queryAll } from '../../../../src/lambda/helpers/dynamo.js';

const client = { send: mockSend } as any;

function keys(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `k${i}` }));
}

describe('chunk', () => {
  it('splits into groups of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 25)).toEqual([]);
  });
});

describe('batchDelete', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it('groups requests 25 at a time', async () => {
    await batchDelete(client, 'T', keys(60));
    const sizes = mockSend.mock.calls.map((c) => c[0].input.RequestItems.T.length);
    expect(sizes).toEqual([25, 25, 10]);
  });

  it('sends nothing for an empty key list', async () => {
    await batchDelete(client, 'T', []);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('retries only the unprocessed items', async () => {
    mockSend
      .mockResolvedValueOnce({
        UnprocessedItems: { T: [{ DeleteRequest: { Key: { id: 'k1' } } }] },
      })
      .mockResolvedValueOnce({});

    await batchDelete(client, 'T', keys(2));
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.RequestItems.T).toEqual([
      { DeleteRequest: { Key: { id: 'k1' } } },
    ]);
  });

  it('throws instead of reporting success when retries run out', async () => {
    mockSend.mockResolvedValue({
      UnprocessedItems: { T: [{ DeleteRequest: { Key: { id: 'k0' } } }] },
    });

    await expect(batchDelete(client, 'T', keys(1))).rejects.toThrow(
      /left 1 item\(s\) unprocessed/,
    );
    expect(mockSend).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
  });
});

describe('batchPut', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it('sends PutRequests', async () => {
    await batchPut(client, 'T', [{ id: 'a' }]);
    expect(mockSend.mock.calls[0][0].input.RequestItems.T).toEqual([
      { PutRequest: { Item: { id: 'a' } } },
    ]);
  });

  it('throws when items stay unprocessed', async () => {
    mockSend.mockResolvedValue({
      UnprocessedItems: { T: [{ PutRequest: { Item: { id: 'a' } } }] },
    });
    await expect(batchPut(client, 'T', [{ id: 'a' }])).rejects.toThrow(/unprocessed/);
  });
});

describe('queryAll', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('follows LastEvaluatedKey to the end', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 1 }], LastEvaluatedKey: { id: 1 } })
      .mockResolvedValueOnce({ Items: [{ id: 2 }] });

    const items = await queryAll(client, { TableName: 'T' } as any);
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: 1 });
  });

  it('keeps going through empty filtered pages', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { id: 1 } })
      .mockResolvedValueOnce({ Items: [{ id: 2 }] });

    expect(await queryAll(client, { TableName: 'T' } as any)).toEqual([{ id: 2 }]);
  });

  it('throws rather than returning a truncated list at the page cap', async () => {
    mockSend.mockResolvedValue({ Items: [{ id: 1 }], LastEvaluatedKey: { id: 1 } });

    await expect(queryAll(client, { TableName: 'Notes' } as any)).rejects.toThrow(
      /exceeded 100 pages/,
    );
  });
});

describe('mapInBatches', () => {
  it('runs at most `concurrency` operations at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];

    await mapInBatches(
      [1, 2, 3, 4, 5],
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        seen.push(n);
        inFlight -= 1;
      },
      2,
    );

    expect(peak).toBe(2);
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
  });
});
