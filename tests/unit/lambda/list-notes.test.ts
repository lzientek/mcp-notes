import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: class { constructor(public input: any) {} },
  BatchGetCommand: class { constructor(public input: any) {} },
}));

process.env.TABLE_NAME = 'NotesTable';

import { handler } from '../../../src/lambda/list-notes.js';

function makeEvent(queryParams: Record<string, string> = {}, userId = 'user-123') {
  return {
    requestContext: { authorizer: { claims: { sub: userId } } },
    queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
  } as any;
}

const sampleNotes = [
  { noteId: 'n1', title: 'Note 1', content: 'hello', tags: ['work'], isFavorite: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' },
  { noteId: 'n2', title: 'Note 2', content: 'world', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  { noteId: 'n3', title: 'Older note', content: 'old stuff', tags: ['personal'], createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' },
];

/** Input of the nth QueryCommand the handler sent. */
function queryInput(call = 0) {
  return mockSend.mock.calls[call][0].input;
}

describe('list-notes handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: sampleNotes });
  });

  it('returns 401 when no userId', async () => {
    const event = { requestContext: { authorizer: { claims: {} } }, queryStringParameters: null } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('queries the UpdatedAtIndex newest-first so DynamoDB does the sorting', async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(queryInput().IndexName).toBe('UpdatedAtIndex');
    expect(queryInput().ScanIndexForward).toBe(false);
    expect(queryInput().Limit).toBe(20);
    const body = JSON.parse(res.body);
    expect(body.notes.map((n: any) => n.noteId)).toEqual(['n1', 'n2', 'n3']);
  });

  it('pushes the favorites filter down to DynamoDB', async () => {
    await handler(makeEvent({ favorites: 'true' }));
    expect(queryInput().FilterExpression).toContain('#isFavorite = :true');
    expect(queryInput().ExpressionAttributeValues[':true']).toBe(true);
  });

  it('pushes tag filters down as a contains OR chain', async () => {
    await handler(makeEvent({ tags: 'personal,work' }));
    expect(queryInput().FilterExpression).toBe('(contains(#tags, :tag0) OR contains(#tags, :tag1))');
    expect(queryInput().ExpressionAttributeValues[':tag0']).toBe('personal');
    expect(queryInput().ExpressionAttributeValues[':tag1']).toBe('work');
  });

  it('pushes date bounds down and keeps "to" inclusive', async () => {
    await handler(makeEvent({ from: '2026-01-01', to: '2026-01-31' }));
    expect(queryInput().FilterExpression).toBe('#createdAt >= :fromDate AND #createdAt <= :toDate');
    expect(queryInput().ExpressionAttributeValues[':toDate']).toBe('2026-01-31T23:59:59.999Z');
  });

  it('treats folderId=root as "no folder"', async () => {
    await handler(makeEvent({ folderId: 'root' }));
    expect(queryInput().FilterExpression).toBe('(attribute_not_exists(#folderId) OR #folderId = :null)');
  });

  it('filters by search in memory (DynamoDB contains is case-sensitive)', async () => {
    const res = await handler(makeEvent({ search: 'HELLO' }));
    expect(queryInput().FilterExpression).toBeUndefined();
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].noteId).toBe('n1');
  });

  it('resumes where DynamoDB stopped, not at the last returned note', async () => {
    // A filter can reject most of a page: rewinding to the last returned note
    // would make the next request re-evaluate everything already rejected.
    const stopped = { userId: 'user-123', noteId: 'n9', updatedAt: '2025-01-01T00:00:00Z' };
    mockSend.mockResolvedValue({ Items: [sampleNotes[0]], LastEvaluatedKey: stopped });

    const res = await handler(makeEvent({ limit: '1' }));
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const decoded = JSON.parse(Buffer.from(body.nextCursor, 'base64url').toString());
    expect(decoded).toEqual(stopped);
    expect(body.hasMore).toBe(true);
  });

  it('rewinds to the last returned note only when the page was trimmed', async () => {
    mockSend.mockResolvedValue({
      Items: sampleNotes,
      LastEvaluatedKey: { userId: 'user-123', noteId: 'n3', updatedAt: '2025-06-01T00:00:00Z' },
    });
    const res = await handler(makeEvent({ limit: '2' }));
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(2);
    const decoded = JSON.parse(Buffer.from(body.nextCursor, 'base64url').toString());
    // n3 was read but not returned, so it has to be read again
    expect(decoded).toEqual({ userId: 'user-123', noteId: 'n2', updatedAt: '2026-01-02T00:00:00Z' });
  });

  it('reports hasMore false and a null cursor on the last page', async () => {
    mockSend.mockResolvedValue({ Items: sampleNotes });
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it('rejects a cursor missing a key component', async () => {
    const cursor = Buffer.from(JSON.stringify({ userId: 'user-123', noteId: 'n2' })).toString('base64url');
    const res = await handler(makeEvent({ cursor }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_CURSOR');
  });

  it("rejects a cursor pointing into another user's partition", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ userId: 'someone-else', noteId: 'n2', updatedAt: '2026-01-02T00:00:00Z' }),
    ).toString('base64url');
    const res = await handler(makeEvent({ cursor }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_CURSOR');
  });

  it('resumes from the cursor instead of restarting the partition', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ userId: 'user-123', noteId: 'n2', updatedAt: '2026-01-02T00:00:00Z' }),
    ).toString('base64url');
    await handler(makeEvent({ cursor }));
    expect(queryInput().ExclusiveStartKey).toEqual({
      userId: 'user-123',
      noteId: 'n2',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('rejects a malformed cursor with 400 instead of silently restarting', async () => {
    const res = await handler(makeEvent({ cursor: 'not-a-cursor' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_CURSOR');
  });

  it('keeps following LastEvaluatedKey until the page is full', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [sampleNotes[0]], LastEvaluatedKey: { userId: 'user-123', noteId: 'n1', updatedAt: '2026-01-03T00:00:00Z' } })
      .mockResolvedValueOnce({ Items: [sampleNotes[1]] });
    const res = await handler(makeEvent({ limit: '2' }));
    expect(mockSend).toHaveBeenCalledTimes(2);
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it('ensures isFavorite defaults to false when missing', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ noteId: 'x', title: 't', content: 'c', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] });
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.notes[0].isFavorite).toBe(false);
  });

  it('includes CORS headers', async () => {
    const res = await handler(makeEvent());
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
  });
});
