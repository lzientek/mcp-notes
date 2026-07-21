# Requirements Document

## Introduction

This feature enables seamless authentication between the mcp-notes web frontend and the local MCP server running in Claude Desktop. Currently, users must manually authenticate via the `mcp_notes_login` tool by typing their email and password directly in Claude Desktop. The goal is to allow users to log in once via the web frontend and have the MCP server automatically pick up the authentication tokens without any manual credential entry.

## Glossary

- **Web_Frontend**: The single-page application hosted on CloudFront/S3 that provides the user interface for signup, confirmation, and login
- **MCP_Server**: The Model Context Protocol server running locally on the user's machine, spawned by Claude Desktop, that provides note-taking tools
- **Token_Bridge**: The mechanism that transfers authentication tokens from the browser session to the local filesystem where the MCP server can read them
- **Credential_Store**: The local file at `~/.mcp-notes/credentials.json` where Cognito tokens are persisted for the MCP server
- **Local_Auth_Server**: A temporary HTTP server running on localhost that receives authentication tokens from the web frontend via a redirect
- **Cognito_Tokens**: The set of ID token, access token, and refresh token issued by AWS Cognito after successful authentication

## Requirements

### Requirement 1: Web Login Form

**User Story:** As a user, I want to log in via the web frontend with my email and password, so that I can authenticate without using Claude Desktop directly.

#### Acceptance Criteria

1. WHEN a user navigates to the web frontend, THE Web_Frontend SHALL display a login form with email and password fields
2. WHEN a user submits valid credentials, THE Web_Frontend SHALL authenticate against Cognito using the USER_PASSWORD_AUTH flow and receive Cognito_Tokens
3. IF a user submits invalid credentials, THEN THE Web_Frontend SHALL display a clear error message indicating the authentication failure reason
4. WHEN authentication succeeds, THE Web_Frontend SHALL proceed to the token transfer step rather than displaying a generic success message

### Requirement 2: Local Auth Server for Token Transfer

**User Story:** As a user, I want the authentication tokens to be transferred automatically to my local machine after web login, so that the MCP server can use them without manual intervention.

#### Acceptance Criteria

1. WHEN the MCP_Server starts, THE Local_Auth_Server SHALL begin listening on a configurable localhost port for incoming token transfer requests
2. THE Local_Auth_Server SHALL accept connections only from localhost to prevent remote access
3. WHEN the Local_Auth_Server receives valid Cognito_Tokens, THE Token_Bridge SHALL write them to the Credential_Store in the expected format
4. WHEN the Local_Auth_Server successfully receives and stores tokens, THE Local_Auth_Server SHALL respond with a confirmation page indicating success
5. IF the Local_Auth_Server receives a malformed or incomplete token payload, THEN THE Local_Auth_Server SHALL reject the request and respond with an error status

### Requirement 3: Frontend Token Delivery

**User Story:** As a user, I want the web frontend to deliver my tokens to the local MCP server after login, so that the process is seamless and requires no copy-pasting.

#### Acceptance Criteria

1. WHEN authentication succeeds in the Web_Frontend, THE Web_Frontend SHALL redirect or send the Cognito_Tokens to the Local_Auth_Server on localhost
2. WHEN the token delivery to localhost succeeds, THE Web_Frontend SHALL display a success message confirming that the MCP server is now authenticated
3. IF the token delivery to localhost fails (server not running or unreachable), THEN THE Web_Frontend SHALL display a clear error message with instructions to ensure the MCP server is running in Claude Desktop
4. THE Web_Frontend SHALL transmit tokens over localhost only, without sending them to any third-party endpoint

### Requirement 4: MCP Server Seamless Token Pickup

**User Story:** As a user, I want the MCP server to automatically use the tokens stored by the web login flow, so that I can immediately access my notes after logging in on the web.

#### Acceptance Criteria

1. WHEN the Credential_Store contains valid tokens written by the Token_Bridge, THE MCP_Server SHALL use those tokens for API requests without requiring re-authentication via the login tool
2. WHEN the Credential_Store contains expired tokens with a valid refresh token, THE MCP_Server SHALL refresh the tokens automatically before making API requests
3. THE MCP_Server SHALL detect credential file changes and use the latest tokens without requiring a restart

### Requirement 5: Security Constraints

**User Story:** As a user, I want the token transfer mechanism to be secure, so that my credentials are not exposed to unauthorized parties.

#### Acceptance Criteria

1. THE Local_Auth_Server SHALL bind exclusively to the loopback interface (127.0.0.1) and reject connections from non-local addresses
2. THE Credential_Store SHALL be written with restrictive file permissions (owner read/write only)
3. THE Web_Frontend SHALL transmit tokens to the Local_Auth_Server using a POST request to avoid token leakage in URL parameters or browser history
4. THE Local_Auth_Server SHALL validate that received tokens contain the expected fields (idToken, accessToken, refreshToken) before persisting them
5. IF the Local_Auth_Server has already received a valid token set for the current session, THEN THE Local_Auth_Server SHALL reject subsequent token submissions to prevent replay attacks

### Requirement 6: User Experience Flow

**User Story:** As a user, I want a clear and guided experience when logging in via the web, so that I understand what is happening and what to do if something goes wrong.

#### Acceptance Criteria

1. WHEN the user is not yet authenticated in the MCP_Server, THE MCP_Server SHALL instruct the user to visit the web frontend URL for login
2. WHEN the Web_Frontend login page loads, THE Web_Frontend SHALL indicate that this login will authenticate the local MCP server
3. WHEN token delivery completes successfully, THE Web_Frontend SHALL display a message confirming the user can return to Claude Desktop and use their notes
4. IF the Local_Auth_Server is not reachable, THEN THE Web_Frontend SHALL provide fallback instructions explaining how to start the MCP server
