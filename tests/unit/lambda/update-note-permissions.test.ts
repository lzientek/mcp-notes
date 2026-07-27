import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
const mockValidateTags = vi.hoisted(() => vi.fn().mockResolvedValue({ valid: true }));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: class { constructor(public input: any) {} },
  GetCommand: class { constructor(public input: any) {} },
  QueryCommand: class { constructor(public input: any) {} },
}));
vi.mock('../../../src/lambda/helpers/validate-tags.js', () => ({
  validateTags: mockValidateTags,
}));

process.env.TABLE_NAME = 'NotesTable';
process.env.TAGS_TABLE_NAME = 'TagsTable';
process.env.SHARES_TABLE_NAME = 'SharesTable';

import { handler } from '../../../src/lambda/update-note.js';

function makeEvent(body: any, noteId = 'note-1', userId = 'user-123', email = 'caller@test.com') {
  return {
    body: JSON.stringify(body),
    pathParameters: { noteId },
    requestContext: { authorizer: { claims: { sub: userId, email } } },
  } as any;
}

const existingNote = {
  userId: 'owner-456',
  noteId: 'note-1',
  title: 'Original',
  content: 'Content',
  tags: ['work'],
  isFavorite: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('update-note permissions (share feature)', () => {
  beforeEach(() => { mockSend.mockReset(); mockValidateTags.mockResolvedValue({ valid: true }); });

  it('allows owner to update all fields including isFavorite', async () => {
    // Owner path: note found with caller's userId
    mockSend.mockResolvedValueOnce({ Item: { ...existingNote, userId: 'user-123' } }); // GetCommand (owner match)
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const res = await handler(makeEvent({ title: 'New', isFavorite: false }, 'note-1', 'user-123'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe('New');
    expect(body.isFavorite).toBe(false);
  });

  it('allows write-recipient to update title/content/tags', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand: not owner
    mockSend.mockResolvedValueOnce({ Items: [{ recipientEmail: 'caller@test.com', permission: 'write', userId: 'owner-456' }] }); // QueryCommand: share found
    mockSend.mockResolvedValueOnce({ Item: existingNote }); // GetCommand: fetch note with owner's userId
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const res = await handler(makeEvent({ title: 'Updated by recipient' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).title).toBe('Updated by recipient');
  });

  it('rejects write-recipient trying to change isFavorite', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // Not owner
    mockSend.mockResolvedValueOnce({ Items: [{ recipientEmail: 'caller@test.com', permission: 'write', userId: 'owner-456' }] });
    mockSend.mockResolvedValueOnce({ Item: existingNote });

    const res = await handler(makeEvent({ isFavorite: false }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects read-recipient with 403', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // Not owner
    mockSend.mockResolvedValueOnce({ Items: [{ recipientEmail: 'caller@test.com', permission: 'read', userId: 'owner-456' }] });

    const res = await handler(makeEvent({ title: 'Attempt' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns 404 when no share exists for caller', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // Not owner
    mockSend.mockResolvedValueOnce({ Items: [] }); // No shares for this email

    const res = await handler(makeEvent({ title: 'Attempt' }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('NOTE_NOT_FOUND');
  });
});
