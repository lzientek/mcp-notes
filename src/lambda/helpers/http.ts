import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS, corsHeadersFor } from './cors.js';

/** Structured error payload returned to clients and to the MCP server. */
export interface ApiErrorBody {
  code: string;
  message: string;
  remedy?: string;
  [key: string]: unknown;
}

/** Identity extracted from the Cognito authorizer claims. */
export interface AuthContext {
  userId: string;
  email: string | null;
}

/**
 * Thrown to short-circuit a handler with a structured error response.
 * Caught by withAuth / withErrorHandling and turned into an HTTP response.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

export function errorResponse(
  statusCode: number,
  body: ApiErrorBody,
  headers: Record<string, string> = CORS_HEADERS,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...headers },
    body: JSON.stringify(body),
  };
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = CORS_HEADERS,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

export function noContentResponse(
  headers: Record<string, string> = CORS_HEADERS,
): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: { ...headers },
    body: '',
  };
}

/**
 * Reads a required path parameter, e.g. requirePathParam(event, 'noteId', 'Note ID').
 * Throws a 400 ApiError when missing.
 */
export function requirePathParam(
  event: APIGatewayProxyEvent,
  name: string,
  label: string,
): string {
  const value = event.pathParameters?.[name];
  if (!value) {
    const lowerLabel = label.charAt(0).toLowerCase() + label.slice(1);
    throw new ApiError(400, {
      code: 'INVALID_REQUEST',
      message: `${label} is required.`,
      remedy: `Include the ${lowerLabel} in the URL path.`,
    });
  }
  return value;
}

/**
 * Body size ceiling for small payloads (a tag name, a share, a list of ids).
 * API Gateway only stops at 10 MB, which is far more than any of these need.
 */
export const SMALL_BODY_LIMIT = 8 * 1024;

/**
 * Ceiling for note content. A DynamoDB item cannot exceed 400 KB, so a larger
 * body could only fail deep in the write with an opaque SDK error.
 */
export const NOTE_BODY_LIMIT = 350 * 1024;

function bodySizeInBytes(event: APIGatewayProxyEvent): number {
  const raw = event.body ?? '';
  return event.isBase64Encoded
    ? Math.floor((raw.length * 3) / 4)
    : Buffer.byteLength(raw, 'utf8');
}

/**
 * Parses a JSON request body, rejecting anything over maxBytes first.
 * Throws a 413 ApiError when too large, a 400 when malformed.
 */
// T is the caller's assertion of the body shape; without it every call site
// would have to cast the result itself.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function parseBody<T>(
  event: APIGatewayProxyEvent,
  remedy: string,
  maxBytes: number = SMALL_BODY_LIMIT,
): T {
  const size = bodySizeInBytes(event);
  if (size > maxBytes) {
    throw new ApiError(413, {
      code: 'PAYLOAD_TOO_LARGE',
      message: `Request body is ${size} bytes, above the ${maxBytes} byte limit.`,
      remedy: 'Split the content into smaller notes or trim the request.',
    });
  }

  try {
    return JSON.parse(event.body ?? '{}') as T;
  } catch {
    throw new ApiError(400, {
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      remedy,
    });
  }
}

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
type AuthedHandler = (
  event: APIGatewayProxyEvent,
  auth: AuthContext,
) => Promise<APIGatewayProxyResult>;

/**
 * Turns thrown ApiErrors into structured responses and unexpected errors into a
 * 500 that still carries CORS headers — an uncaught throw would otherwise surface
 * as a CORS-less 502 in the browser.
 */
export function withErrorHandling(
  handler: Handler,
  headers?: Record<string, string>,
): Handler {
  return async (event) => {
    // A public endpoint passes its own headers; everyone else gets the origin
    // resolved per request, since Allow-Origin only holds one value.
    const responseHeaders = headers ?? corsHeadersFor(event);
    try {
      const response = await handler(event);
      return { ...response, headers: { ...responseHeaders, ...response.headers } };
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.statusCode, err.body, responseHeaders);
      }
      console.error('Unhandled error:', err);
      return errorResponse(
        500,
        {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          remedy: 'Retry in a few moments. If the problem persists, report it.',
        },
        responseHeaders,
      );
    }
  };
}

/** Wraps a handler with Cognito claim extraction plus withErrorHandling. */
export function withAuth(
  handler: AuthedHandler,
  headers?: Record<string, string>,
): Handler {
  return withErrorHandling(async (event) => {
    const userId = event.requestContext.authorizer?.claims?.sub as
      | string
      | undefined;
    if (!userId) {
      return errorResponse(401, {
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
        remedy: 'Ensure your request includes a valid authorization token.',
      });
    }
    const email = (event.requestContext.authorizer?.claims?.email ?? null) as
      | string
      | null;
    return handler(event, { userId, email });
  }, headers);
}
