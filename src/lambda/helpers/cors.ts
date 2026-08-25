import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Origins allowed to call the API, most-canonical first. Injected by the stack
 * so a dev deployment can add http://localhost:… without touching the code.
 */
export const ALLOWED_ORIGINS: string[] = (
  process.env.ALLOWED_ORIGINS ?? 'https://www.notlai.com,https://notlai.com'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0] ?? 'https://www.notlai.com';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': DEFAULT_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  Vary: 'Origin',
};

/**
 * Access-Control-Allow-Origin only accepts one value, so the allowed origin has
 * to be picked per request: echo the caller's origin when it is on the list,
 * fall back to the canonical one otherwise.
 */
export function corsHeadersFor(event: APIGatewayProxyEvent): Record<string, string> {
  const requestOrigin = event.headers?.origin ?? event.headers?.Origin;
  const origin =
    requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)
      ? requestOrigin
      : DEFAULT_ORIGIN;

  return { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin };
}

export function withCors(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: { ...CORS_HEADERS, ...response.headers },
  };
}
