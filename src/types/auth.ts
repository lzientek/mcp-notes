/**
 * Tokens returned by AWS Cognito after successful authentication.
 * Stored locally in the credentials file for reuse across sessions.
 */
export interface CognitoTokens {
  idToken: string;
  refreshToken: string;
  accessToken: string;
  /** Unix timestamp (seconds) when the idToken expires */
  expiresAt: number;
}

/**
 * Structured error response returned to the LLM when authentication fails.
 * Contains enough information for the LLM to explain the issue to the user.
 */
export interface AuthErrorResponse {
  /** Machine-readable error code (e.g. AUTH_INVALID_CREDENTIALS) */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Actionable instruction for the user to resolve the issue */
  remedy: string;
}
