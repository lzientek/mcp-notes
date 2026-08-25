import { describe, it, expect } from 'vitest';
import {
  ApiError,
  NOTE_BODY_LIMIT,
  SMALL_BODY_LIMIT,
  errorResponse,
  jsonResponse,
  noContentResponse,
  parseBody,
  requirePathParam,
  withAuth,
  withErrorHandling,
} from '../../../../src/lambda/helpers/http.js';

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    requestContext: { authorizer: { claims: { sub: 'user-123', email: 'a@b.c' } } },
    pathParameters: null,
    body: null,
    ...overrides,
  } as any;
}

describe('response builders', () => {
  it('errorResponse carries CORS headers and the payload', () => {
    const res = errorResponse(404, { code: 'NOPE', message: 'Not found.' });
    expect(res.statusCode).toBe(404);
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
    expect(JSON.parse(res.body).code).toBe('NOPE');
  });

  it('jsonResponse sets a JSON content type', () => {
    const res = jsonResponse(201, { ok: true });
    expect(res.headers?.['Content-Type']).toBe('application/json');
  });

  it('noContentResponse has an empty body', () => {
    expect(noContentResponse()).toMatchObject({ statusCode: 204, body: '' });
  });

  it('honours custom headers for public endpoints', () => {
    const res = errorResponse(400, { code: 'X', message: 'y' }, { 'Access-Control-Allow-Origin': '*' });
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});

describe('requirePathParam', () => {
  it('returns the value when present', () => {
    const event = makeEvent({ pathParameters: { noteId: 'n1' } });
    expect(requirePathParam(event, 'noteId', 'Note ID')).toBe('n1');
  });

  it('throws a 400 with the label in the message', () => {
    try {
      requirePathParam(makeEvent(), 'noteId', 'Note ID');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).body.message).toBe('Note ID is required.');
      expect((err as ApiError).body.remedy).toBe('Include the note ID in the URL path.');
    }
  });
});

describe('parseBody', () => {
  it('parses a JSON body', () => {
    const event = makeEvent({ body: JSON.stringify({ name: 'work' }) });
    expect(parseBody<{ name: string }>(event, 'remedy').name).toBe('work');
  });

  it('defaults to an empty object when there is no body', () => {
    expect(parseBody(makeEvent(), 'remedy')).toEqual({});
  });

  it('throws a 400 on malformed JSON', () => {
    const event = makeEvent({ body: '{nope' });
    expect(() => parseBody(event, 'Send an object.')).toThrowError(ApiError);
  });

  it('rejects a body above the small limit with 413', () => {
    const event = makeEvent({ body: 'x'.repeat(SMALL_BODY_LIMIT + 1) });
    try {
      parseBody(event, 'remedy');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(413);
      expect((err as ApiError).body.code).toBe('PAYLOAD_TOO_LARGE');
    }
  });

  it('accepts a large note body under the note limit', () => {
    const content = 'x'.repeat(100 * 1024);
    const event = makeEvent({ body: JSON.stringify({ content }) });
    expect(parseBody<{ content: string }>(event, 'remedy', NOTE_BODY_LIMIT).content).toHaveLength(100 * 1024);
  });

  it('measures bytes, not characters', () => {
    // 4 bytes per emoji in UTF-8: just over the limit in bytes, well under in length
    const event = makeEvent({ body: '😀'.repeat(SMALL_BODY_LIMIT / 4 + 1) });
    expect(() => parseBody(event, 'remedy')).toThrowError(ApiError);
  });

  it('accounts for base64 encoding when API Gateway sets the flag', () => {
    const event = makeEvent({
      body: 'x'.repeat(SMALL_BODY_LIMIT + 100),
      isBase64Encoded: true,
    });
    // base64 inflates by 4/3, so the decoded size is under the limit: the size
    // check passes and the body only fails later, on JSON parsing
    try {
      parseBody(event, 'remedy');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).body.code).toBe('INVALID_REQUEST');
    }
  });
});

describe('withAuth', () => {
  it('rejects a request with no sub claim', async () => {
    const handler = withAuth(async () => jsonResponse(200, {}));
    const res = await handler({ requestContext: { authorizer: { claims: {} } } } as any);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('AUTH_REQUIRED');
  });

  it('passes userId and email through', async () => {
    const handler = withAuth(async (_event, auth) => jsonResponse(200, auth));
    const res = await handler(makeEvent());
    expect(JSON.parse(res.body)).toEqual({ userId: 'user-123', email: 'a@b.c' });
  });

  it('turns a thrown ApiError into its response', async () => {
    const handler = withAuth(async () => {
      throw new ApiError(409, { code: 'CONFLICT', message: 'Already there.' });
    });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('CONFLICT');
  });

  it('turns an unexpected throw into a 500 that still carries CORS headers', async () => {
    const handler = withAuth(async () => {
      throw new Error('DynamoDB exploded');
    });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe('INTERNAL_ERROR');
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://www.notlai.com');
    // the raw error must not leak to the caller
    expect(res.body).not.toContain('DynamoDB exploded');
  });
});

describe('withErrorHandling', () => {
  it('applies the custom headers of a public endpoint to errors', async () => {
    const handler = withErrorHandling(async () => {
      throw new ApiError(404, { code: 'SHARE_NOT_FOUND', message: 'Gone.' });
    }, { 'Access-Control-Allow-Origin': '*' });
    const res = await handler(makeEvent());
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
