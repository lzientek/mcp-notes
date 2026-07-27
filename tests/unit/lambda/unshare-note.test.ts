import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: class { constructor(public input: any) {} },
  DeleteCommand: class { constructor(public input: any) {} },
  QueryCommand: class { constructor(public input: any) {} },
}));

process.env.TABLE_NAME = 'NotesTable';
process.env.SHARES_TABLE_NAME = 'SharesTable';

import { handler } from '../../../src/lambda/unshare-note.js';

function makeEvent(queryParams: Record<string, string>, noteId = 'note-1', userId = 'user-123') {
  return {
    body: null,
    pathParameters: { noteId },
    queryStringParameters: queryParams,
    requestContext: { authorizer: { claims: { sub: userId } } },
  } as any;
}

describe('unshare-note handler', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns 401 when no userId', async () => {
    const event = { body: null, pathParameters: { noteId: 'x' }, queryStringParameters: { type: 'public' }, requestContext: { authorizer: { claims: {} } } } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when no type or email provided', async () => {
    const event = { body: null, pathParameters: { noteId: 'x' }, queryStringParameters: {}, requestContext: { authorizer: { claims: { sub: 'user-1' } } } } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when note not owned by caller', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // Note not found under this userId
    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(403);
  });

  it('revokes public share and returns 204', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } }); // Note exists
    mockSend.mockResolvedValueOnce({ Items: [{ shareId: 'share-1', type: 'public' }] }); // Query shares
    mockSend.mockResolvedValueOnce({}); // Delete share

    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(204);
  });

  it('returns 204 even if no public share exists (idempotent)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] }); // No shares

    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(204);
  });

  it('revokes user share by email', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [{ shareId: 'share-2', type: 'user', recipientEmail: 'bob@test.com' }] });
    mockSend.mockResolvedValueOnce({}); // Delete

    const res = await handler(makeEvent({ email: 'bob@test.com' }));
    expect(res.statusCode).toBe(204);
  });

  it('includes CORS headers', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
  });
});
