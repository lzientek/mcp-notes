import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: class { constructor(public input: any) {} },
  GetCommand: class { constructor(public input: any) {} },
}));
vi.mock('../../../../src/lambda/helpers/validate-tags.js', () => ({
  validateTags: vi.fn().mockResolvedValue({ valid: true }),
}));

process.env.TABLE_NAME = 'NotesTable';
process.env.TAGS_TABLE_NAME = 'TagsTable';

import { handler } from '../../../src/lambda/update-note.js';

const existingNote = {
  userId: 'user-123',
  noteId: 'note-1',
  title: 'Old title',
  content: 'Old content',
  tags: ['work'],
  isFavorite: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeEvent(body: any, noteId = 'note-1', userId = 'user-123') {
  return {
    body: JSON.stringify(body),
    pathParameters: { noteId },
    requestContext: { authorizer: { claims: { sub: userId } } },
  } as any;
}

describe('update-note handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    // First call: GetCommand (existing note), Second call: PutCommand
    mockSend.mockResolvedValueOnce({ Item: existingNote });
    mockSend.mockResolvedValueOnce({});
  });

  it('returns 401 when no userId', async () => {
    const event = { body: '{}', pathParameters: { noteId: 'x' }, requestContext: { authorizer: { claims: {} } } } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when note not found', async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent({ title: 'New' }));
    expect(res.statusCode).toBe(404);
  });

  it('updates only provided fields', async () => {
    const res = await handler(makeEvent({ title: 'New title' }));
    expect(res.statusCode).toBe(200);
    const note = JSON.parse(res.body);
    expect(note.title).toBe('New title');
    expect(note.content).toBe('Old content');
    expect(note.tags).toEqual(['work']);
    expect(note.isFavorite).toBe(false);
  });

  it('updates isFavorite without changing other fields', async () => {
    const res = await handler(makeEvent({ isFavorite: true }));
    expect(res.statusCode).toBe(200);
    const note = JSON.parse(res.body);
    expect(note.isFavorite).toBe(true);
    expect(note.title).toBe('Old title');
  });

  it('includes CORS headers', async () => {
    const res = await handler(makeEvent({}));
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
  });
});
