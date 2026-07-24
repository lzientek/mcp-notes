import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
const mockValidateTags = vi.hoisted(() => vi.fn().mockResolvedValue({ valid: true }));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: class { constructor(public input: any) {} },
}));
vi.mock('ulid', () => ({ ulid: () => 'TEST_ULID_001' }));
vi.mock('../../../src/lambda/helpers/validate-tags.js', () => ({
  validateTags: mockValidateTags,
}));

process.env.TABLE_NAME = 'NotesTable';
process.env.TAGS_TABLE_NAME = 'TagsTable';

import { handler } from '../../../src/lambda/create-note.js';

function makeEvent(body: any, userId = 'user-123') {
  return {
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { sub: userId } } },
  } as any;
}

describe('create-note handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockValidateTags.mockResolvedValue({ valid: true });
  });

  it('returns 401 when no userId', async () => {
    const event = { body: '{}', requestContext: { authorizer: { claims: {} } } } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = {
      body: 'not json',
      requestContext: { authorizer: { claims: { sub: 'user-1' } } },
    } as any;
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_REQUEST');
  });

  it('creates a note with defaults', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await handler(makeEvent({}));

    expect(res.statusCode).toBe(201);
    const note = JSON.parse(res.body);
    expect(note.noteId).toBe('TEST_ULID_001');
    expect(note.title).toBe('Untitled');
    expect(note.content).toBe('');
    expect(note.tags).toEqual([]);
    expect(note.isFavorite).toBe(false);
    expect(note.userId).toBe('user-123');
  });

  it('creates a note with all fields', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await handler(makeEvent({
      title: 'My Note',
      content: '# Hello',
      tags: ['Work'],
      isFavorite: true,
    }));

    expect(res.statusCode).toBe(201);
    const note = JSON.parse(res.body);
    expect(note.title).toBe('My Note');
    expect(note.content).toBe('# Hello');
    expect(note.tags).toEqual(['work']);
    expect(note.isFavorite).toBe(true);
  });

  it('returns 400 when tags are invalid', async () => {
    mockValidateTags.mockResolvedValueOnce({ valid: false, invalidTags: ['bad'] });
    mockSend.mockResolvedValueOnce({});
    const res = await handler(makeEvent({ tags: ['bad'] }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('INVALID_TAGS');
  });

  it('includes CORS headers', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await handler(makeEvent({}));
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
  });
});
