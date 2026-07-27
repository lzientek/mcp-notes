import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: class { constructor(public input: any) {} },
}));

process.env.TABLE_NAME = 'NotesTable';
process.env.SHARES_TABLE_NAME = 'SharesTable';

import { handler } from '../../../src/lambda/get-shared-note.js';

function makeEvent(shareId = 'abc123') {
  return {
    pathParameters: { shareId },
    requestContext: {},
  } as any;
}

describe('get-shared-note handler', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns 404 when share not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('SHARE_NOT_FOUND');
  });

  it('returns 404 when note not found (orphaned share)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { shareId: 'abc', userId: 'u1', noteId: 'n1' } }); // Share exists
    mockSend.mockResolvedValueOnce({ Item: undefined }); // Note not found
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
  });

  it('returns note content without sensitive fields', async () => {
    mockSend.mockResolvedValueOnce({ Item: { shareId: 'abc', userId: 'u1', noteId: 'n1' } });
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: 'u1', noteId: 'n1', title: 'Test Note', content: '# Hello',
        tags: ['work'], isFavorite: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      },
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe('Test Note');
    expect(body.content).toBe('# Hello');
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();
    // Privacy: these should NOT be present
    expect(body.userId).toBeUndefined();
    expect(body.noteId).toBeUndefined();
    expect(body.tags).toBeUndefined();
    expect(body.isFavorite).toBeUndefined();
  });

  it('uses public CORS headers (allow all origins)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { shareId: 'abc', userId: 'u1', noteId: 'n1' } });
    mockSend.mockResolvedValueOnce({
      Item: { userId: 'u1', noteId: 'n1', title: 'T', content: 'C', createdAt: 'x', updatedAt: 'y' },
    });
    const res = await handler(makeEvent());
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
