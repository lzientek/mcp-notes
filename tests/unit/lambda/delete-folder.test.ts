import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: ESM imports are evaluated before top-level statements, so the handler
// would otherwise read whatever TABLE_NAME another test file left behind.
vi.hoisted(() => {
  process.env.TABLE_NAME = 'NotesTable';
  process.env.FOLDERS_TABLE_NAME = 'FoldersTable';
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

import { handler } from '../../../src/lambda/delete-folder.js';

function makeEvent(folderId: string | null = 'work', userId: string | null = 'user-123') {
  return {
    requestContext: { authorizer: { claims: userId ? { sub: userId } : {} } },
    pathParameters: folderId ? { folderId } : null,
  } as any;
}

function commandsOfType(type: string) {
  return mockSend.mock.calls.map((c) => c[0]).filter((c) => c.type === type);
}

describe('delete-folder handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns 401 without a userId', async () => {
    mockSend.mockResolvedValue({});
    const res = await handler(makeEvent('work', null));
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 without a folder ID', async () => {
    mockSend.mockResolvedValue({});
    const res = await handler(makeEvent(null));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the folder does not belong to the caller', async () => {
    mockSend.mockResolvedValue({});
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('FOLDER_NOT_FOUND');
  });

  it('lets DynamoDB filter the affected notes instead of scanning the partition', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') return { Item: { userId: 'user-123', folderId: 'work' } };
      if (cmd.type === 'Query') return { Items: [] };
      return {};
    });

    await handler(makeEvent());

    const query = commandsOfType('Query')[0];
    expect(query.input.FilterExpression).toBe('#folderId = :folderId');
    expect(query.input.ExpressionAttributeValues[':folderId']).toBe('work');
    expect(query.input.ProjectionExpression).toBe('noteId');
  });

  it('moves the notes back to root with partial updates, not whole-item rewrites', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') return { Item: { userId: 'user-123', folderId: 'work' } };
      if (cmd.type === 'Query') return { Items: [{ noteId: 'n1' }, { noteId: 'n2' }] };
      return {};
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(204);

    const updates = commandsOfType('Update');
    expect(updates).toHaveLength(2);
    expect(updates[0].input.UpdateExpression).toBe('SET #folderId = :null, updatedAt = :now');
    expect(updates[0].input.Key).toEqual({ userId: 'user-123', noteId: 'n1' });
    expect(updates[0].input.ExpressionAttributeValues[':null']).toBeNull();

    expect(commandsOfType('Delete')[0].input.Key).toEqual({
      userId: 'user-123',
      folderId: 'work',
    });
  });

  it('follows LastEvaluatedKey so a large folder is fully emptied', async () => {
    let queries = 0;
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Get') return { Item: { userId: 'user-123', folderId: 'work' } };
      if (cmd.type === 'Query') {
        queries += 1;
        return queries === 1
          ? { Items: [{ noteId: 'n1' }], LastEvaluatedKey: { userId: 'user-123', noteId: 'n1' } }
          : { Items: [{ noteId: 'n2' }] };
      }
      return {};
    });

    await handler(makeEvent());
    expect(queries).toBe(2);
    expect(commandsOfType('Update')).toHaveLength(2);
  });
});
