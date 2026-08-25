import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: ESM imports are evaluated before top-level statements, so the handler
// would otherwise read whatever TABLE_NAME another test file left behind.
vi.hoisted(() => {
  process.env.TABLE_NAME = 'NotesTable';
  process.env.TAGS_TABLE_NAME = 'TagsTable';
});

const mockSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class { },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: class { readonly type = 'Query'; constructor(public input: any) {} },
  GetCommand: class { readonly type = 'Get'; constructor(public input: any) {} },
  DeleteCommand: class { readonly type = 'Delete'; constructor(public input: any) {} },
  UpdateCommand: class { readonly type = 'Update'; constructor(public input: any) {} },
}));

import { handler } from '../../../src/lambda/delete-tag.js';

function makeEvent(tagId: string | null = 'work', userId: string | null = 'user-123') {
  return {
    requestContext: { authorizer: { claims: userId ? { sub: userId } : {} } },
    pathParameters: tagId ? { tagId } : null,
  } as any;
}

function commandsOfType(type: string) {
  return mockSend.mock.calls.map((c) => c[0]).filter((c) => c.type === type);
}

/** Tag exists; the notes query returns whatever the test provides. */
function withNotes(notes: Record<string, unknown>[]) {
  mockSend.mockImplementation(async (cmd: any) => {
    if (cmd.type === 'Get') return { Item: { userId: 'user-123', tagId: 'work', name: 'work' } };
    if (cmd.type === 'Query') return { Items: notes };
    return {};
  });
}

describe('delete-tag handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns 401 without a userId', async () => {
    mockSend.mockResolvedValue({});
    const res = await handler(makeEvent('work', null));
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when the tag does not exist for the caller', async () => {
    mockSend.mockResolvedValue({});
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('TAG_NOT_FOUND');
  });

  it('lets DynamoDB find the tagged notes instead of filtering in memory', async () => {
    withNotes([]);
    await handler(makeEvent());

    const query = commandsOfType('Query')[0];
    expect(query.input.FilterExpression).toBe('contains(#tags, :tagName)');
    expect(query.input.ExpressionAttributeValues[':tagName']).toBe('work');
    expect(query.input.ProjectionExpression).toBe('noteId, #tags');
  });

  it('removes the single list element instead of rewriting the note', async () => {
    withNotes([{ noteId: 'n1', tags: ['personal', 'work'] }]);

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(204);

    const update = commandsOfType('Update')[0];
    expect(update.input.UpdateExpression).toBe('REMOVE #tags[1] SET updatedAt = :now');
    expect(update.input.ConditionExpression).toBe('#tags[1] = :tagName');
    expect(update.input.Key).toEqual({ userId: 'user-123', noteId: 'n1' });
  });

  it('skips notes whose tag vanished between the query and the update', async () => {
    withNotes([{ noteId: 'n1', tags: ['personal'] }]);
    await handler(makeEvent());
    expect(commandsOfType('Update')).toHaveLength(0);
  });

  it('re-reads and retries when a concurrent edit shifted the index', async () => {
    let updates = 0;
    let gets = 0;
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') {
        gets += 1;
        // first Get resolves the tag row, later ones re-read the note's tags
        return gets === 1
          ? { Item: { userId: 'user-123', tagId: 'work', name: 'work' } }
          : { Item: { tags: ['work'] } }; // 'admin' was removed, 'work' moved to 0
      }
      if (cmd.type === 'Query') return { Items: [{ noteId: 'n1', tags: ['admin', 'work'] }] };
      if (cmd.type === 'Update') {
        updates += 1;
        if (updates === 1) {
          const err = new Error('condition failed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
        return {};
      }
      return {};
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(204);

    const updateCmds = commandsOfType('Update');
    expect(updateCmds).toHaveLength(2);
    expect(updateCmds[0].input.UpdateExpression).toContain('#tags[1]');
    // recomputed against the re-read list
    expect(updateCmds[1].input.UpdateExpression).toContain('#tags[0]');
  });

  it('stops without deleting the tag when the conflict will not clear', async () => {
    let gets = 0;
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') {
        gets += 1;
        return gets === 1
          ? { Item: { userId: 'user-123', tagId: 'work', name: 'work' } }
          : { Item: { tags: ['work'] } };
      }
      if (cmd.type === 'Query') return { Items: [{ noteId: 'n1', tags: ['work'] }] };
      if (cmd.type === 'Update') {
        const err = new Error('condition failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });

    const res = await handler(makeEvent());
    // 500 rather than a 204 that leaves the note pointing at a deleted tag
    expect(res.statusCode).toBe(500);
    expect(commandsOfType('Delete')).toHaveLength(0);
  });

  it('gives up on a note whose tag really did vanish, without failing', async () => {
    let gets = 0;
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') {
        gets += 1;
        return gets === 1
          ? { Item: { userId: 'user-123', tagId: 'work', name: 'work' } }
          : { Item: { tags: [] } }; // another request already stripped it
      }
      if (cmd.type === 'Query') return { Items: [{ noteId: 'n1', tags: ['work'] }] };
      if (cmd.type === 'Update') {
        const err = new Error('condition failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(204);
    expect(commandsOfType('Delete')).toHaveLength(1);
  });

  it('propagates an unexpected DynamoDB error', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') return { Item: { userId: 'user-123', tagId: 'work', name: 'work' } };
      if (cmd.type === 'Query') return { Items: [{ noteId: 'n1', tags: ['work'] }] };
      if (cmd.type === 'Update') throw new Error('ProvisionedThroughputExceeded');
      return {};
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(commandsOfType('Delete')).toHaveLength(0);
  });

  it('still deletes the tag itself', async () => {
    withNotes([]);
    await handler(makeEvent());
    expect(commandsOfType('Delete')[0].input.Key).toEqual({
      userId: 'user-123',
      tagId: 'work',
    });
  });
});
