import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Property 7: Data isolation via partition key
 * For any Lambda handler invocation with a given userId in claims,
 * every DynamoDB operation constructed by the handler uses that userId as partition key.
 * No operation references a different user's partition.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

// Track all DynamoDB commands sent
const sentCommands: Array<{ type: string; input: Record<string, unknown> }> = [];

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {
    constructor() {
      // no-op
    }
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: async (command: { type: string; input: Record<string, unknown> }) => {
        sentCommands.push(command);
        return { Items: [], Item: { userId: 'x', noteId: 'y', title: 't', content: 'c', createdAt: '', updatedAt: '' } };
      },
    }),
  },
  QueryCommand: class QueryCommand {
    type = 'Query';
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  PutCommand: class PutCommand {
    type = 'Put';
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetCommand: class GetCommand {
    type = 'Get';
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteCommand: class DeleteCommand {
    type = 'Delete';
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

// Set environment variable before importing handlers
vi.stubEnv('TABLE_NAME', 'test-table');

function makeEvent(userId: string, method: string, noteId?: string): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    body: JSON.stringify({ title: 'Test', content: 'Content' }),
    pathParameters: noteId ? { noteId } : null,
    requestContext: {
      authorizer: {
        claims: { sub: userId },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('Property 7: Data isolation via partition key', () => {
  beforeEach(() => {
    sentCommands.length = 0;
  });

  it('listNotes always queries with the authenticated userId as PK', async () => {
    const { handler } = await import('../../../src/lambda/list-notes.js');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (userId) => {
          sentCommands.length = 0;
          const event = makeEvent(userId, 'GET');
          await handler(event);

          expect(sentCommands.length).toBeGreaterThan(0);
          const cmd = sentCommands[0];
          expect((cmd.input as { ExpressionAttributeValues: Record<string, string> }).ExpressionAttributeValues[':uid']).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('createNote always writes with the authenticated userId as PK', async () => {
    const { handler } = await import('../../../src/lambda/create-note.js');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (userId) => {
          sentCommands.length = 0;
          const event = makeEvent(userId, 'POST');
          await handler(event);

          expect(sentCommands.length).toBeGreaterThan(0);
          const cmd = sentCommands[0];
          expect((cmd.input as { Item: { userId: string } }).Item.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getNote always queries with the authenticated userId as PK', async () => {
    const { handler } = await import('../../../src/lambda/get-note.js');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 26 }),
        async (userId, noteId) => {
          sentCommands.length = 0;
          const event = makeEvent(userId, 'GET', noteId);
          await handler(event);

          expect(sentCommands.length).toBeGreaterThan(0);
          const cmd = sentCommands[0];
          expect((cmd.input as { Key: { userId: string } }).Key.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deleteNote always deletes with the authenticated userId as PK', async () => {
    const { handler } = await import('../../../src/lambda/delete-note.js');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 26 }),
        async (userId, noteId) => {
          sentCommands.length = 0;
          const event = makeEvent(userId, 'DELETE', noteId);
          await handler(event);

          expect(sentCommands.length).toBeGreaterThan(0);
          const cmd = sentCommands[0];
          expect((cmd.input as { Key: { userId: string } }).Key.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no handler ever uses a userId different from claims.sub', async () => {
    const { handler: listHandler } = await import('../../../src/lambda/list-notes.js');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (realUserId, otherUserId) => {
          fc.pre(realUserId !== otherUserId);
          sentCommands.length = 0;

          const event = makeEvent(realUserId, 'GET');
          await listHandler(event);

          for (const cmd of sentCommands) {
            const input = cmd.input as Record<string, unknown>;
            if (input.ExpressionAttributeValues) {
              const values = Object.values(input.ExpressionAttributeValues as Record<string, string>);
              expect(values).not.toContain(otherUserId);
            }
            if (input.Key) {
              expect((input.Key as { userId: string }).userId).not.toBe(otherUserId);
            }
            if (input.Item) {
              expect((input.Item as { userId: string }).userId).not.toBe(otherUserId);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
