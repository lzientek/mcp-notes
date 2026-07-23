import type { APIGatewayProxyResult } from 'aws-lambda';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://www.notlai.com',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export function withCors(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: { ...CORS_HEADERS, ...response.headers },
  };
}
