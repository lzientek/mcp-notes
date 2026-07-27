import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  GetCommand: class { constructor(public input: any) {} },
  PutCommand: class { constructor(public input: any) {} },
  QueryCommand: class { constructor(public input: any) {} },
}));
vi.mock('../../../src/lambda/helpers/share-id.js', () => ({
  generateShareId: () => 'TEST_SHARE_ID_123456',
}));

vi.hoisted(() => {
  process.env.TABLE_NAME = 'NotesTable';
  process.env.SHARES_TABLE_NAME = 'SharesTable';
  process.env.FRONTEND_URL = 'https://www.notlai.com';
});

import { handler } from '../../../src/lambda/share-note.js';

function makeEvent(body: any, noteId = 'note-1', userId = 'user-123') {
  return {
    body: JSON.stringify(body),
    pathParameters: { noteId },
    requestContext: { authorizer: { claims: { sub: userId } } },
  } as any;
}

describe('share-note handler', () => {
  beforeEach(() => { mockSend.mockReset(); });

  it('returns 401 when no userId', async () => {
    const event = { body: '{}', pathParameters: { noteId: 'x' }, requestContext: { authorizer: { claims: {} } } } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid type', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    const res = await handler(makeEvent({ type: 'invalid' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for user share without email', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    const res = await handler(makeEvent({ type: 'user' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when note not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand returns nothing
    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(404);
  });

  it('creates a public share link', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } }); // GetCommand: note exists
    mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand: no existing shares
    mockSend.mockResolvedValueOnce({}); // PutCommand: create share

    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.shareUrl).toBe('https://www.notlai.com/shared/TEST_SHARE_ID_123456');
    expect(body.type).toBe('public');
    expect(body.permission).toBe('read');
  });

  it('returns existing public share link (idempotent)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [{ shareId: 'existing-id', type: 'public' }] });

    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.shareId).toBe('existing-id');
  });

  it('creates a user share with default read permission', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent({ type: 'user', email: 'bob@test.com' }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.email).toBe('bob@test.com');
    expect(body.permission).toBe('read');
  });

  it('creates a user share with write permission', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent({ type: 'user', email: 'bob@test.com', permission: 'write' }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).permission).toBe('write');
  });

  it('forces public shares to read-only even if write requested', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent({ type: 'public', permission: 'write' }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).permission).toBe('read');
  });

  it('includes CORS headers', async () => {
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', noteId: 'note-1' } });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});
    const res = await handler(makeEvent({ type: 'public' }));
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
  });
});
