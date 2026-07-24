import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: class { constructor(public input: any) {} },
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

  it('returns notes sorted by updatedAt desc', async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.notes[0].noteId).toBe('n1');
    expect(body.notes[1].noteId).toBe('n2');
  });

  it('filters by favorites', async () => {
    const res = await handler(makeEvent({ favorites: 'true' }));
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].noteId).toBe('n1');
  });

  it('filters by tags', async () => {
    const res = await handler(makeEvent({ tags: 'personal' }));
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].noteId).toBe('n3');
  });

  it('filters by search', async () => {
    const res = await handler(makeEvent({ search: 'hello' }));
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].noteId).toBe('n1');
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
