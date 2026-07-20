/**
 * Runtime configuration for the MCP server.
 * Values are set after CDK deployment and consumed by the local MCP process.
 */
export interface McpNotesConfig {
  /** AWS Cognito User Pool Client ID (public, no secret) */
  cognitoClientId: string;
  /** API Gateway base URL (e.g. https://xxxxx.execute-api.eu-west-1.amazonaws.com/prod) */
  apiGatewayUrl: string;
  /** AWS region where the stack is deployed */
  region: string;
}
