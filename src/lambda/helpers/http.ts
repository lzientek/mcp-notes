import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from './cors.js';

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

/** Parses a JSON request body. Throws a 400 ApiError when the body is malformed. */
export function parseBody<T>(event: APIGatewayProxyEvent, remedy: string): T {
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
  headers: Record<string, string> = CORS_HEADERS,
): Handler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.statusCode, err.body, headers);
      }
      console.error('Unhandled error:', err);
      return errorResponse(
        500,
        {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          remedy: 'Retry in a few moments. If the problem persists, report it.',
        },
        headers,
      );
    }
  };
}

/** Wraps a handler with Cognito claim extraction plus withErrorHandling. */
export function withAuth(
  handler: AuthedHandler,
  headers: Record<string, string> = CORS_HEADERS,
): Handler {
  return withErrorHandling(async (event) => {
    const userId = event.requestContext.authorizer?.claims?.sub as
      | string
      | undefined;
    if (!userId) {
      return errorResponse(
        401,
        {
          code: 'AUTH_REQUIRED',
          message: 'Authentication is required.',
          remedy: 'Ensure your request includes a valid authorization token.',
        },
        headers,
      );
    }
    const email = (event.requestContext.authorizer?.claims?.email ?? null) as
      | string
      | null;
    return handler(event, { userId, email });
  }, headers);
}
