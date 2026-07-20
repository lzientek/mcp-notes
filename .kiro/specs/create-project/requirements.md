# Requirements Document

## Introduction

This document defines the requirements for the "User Authentication" feature in mcp-notes. This feature enables users to create an account (email + password), authenticate their MCP server instance once, and then access their notes seamlessly across all subsequent LLM conversations without re-authentication. The authentication mechanism ensures strict user data isolation and provides clear error messages that the LLM can relay to the user.

## Glossary

- **Auth_Service**: The backend service responsible for account management, credential verification, and token issuance
- **MCP_Server**: The MCP (Model Context Protocol) server instance that connects Claude Desktop to the mcp-notes backend on behalf of the User
- **User**: A person who creates an account and interacts with mcp-notes through an LLM (Claude Desktop)
- **Credentials_File**: A local file on the User's machine that stores the authentication token, read by the MCP_Server at startup
- **Auth_Token**: A long-lived, cryptographically signed token issued by the Auth_Service upon successful authentication
- **Email**: The unique email address used as the User's account identifier
- **Password_Hash**: The result of applying a one-way hashing algorithm to the User's password for secure storage

## Requirements

### Requirement 1: Create a user account

**User Story:** As a User, I want to create an account with my email and a password, so that I can have a personal space for my notes.

#### Acceptance Criteria

1. WHEN the User submits a valid email and password, THE Auth_Service SHALL create a new account and return a confirmation with the account identifier
2. WHEN the User submits an account creation request, THE Auth_Service SHALL verify that the email is not already associated with an existing account
3. IF the User submits an email that is already registered, THEN THE Auth_Service SHALL return an error indicating the email is already in use
4. THE Auth_Service SHALL accept only email addresses that conform to standard email format (local-part@domain)
5. IF the User submits an invalid email format, THEN THE Auth_Service SHALL return an error indicating the email format is invalid

### Requirement 2: Enforce password security on account creation

**User Story:** As a User, I want my password to be stored securely, so that my account is protected from unauthorized access.

#### Acceptance Criteria

1. WHEN the User creates an account, THE Auth_Service SHALL store the password as a Password_Hash using bcrypt with a minimum cost factor of 10
2. THE Auth_Service SHALL require a password of at least 8 characters in length
3. IF the User submits a password shorter than 8 characters, THEN THE Auth_Service SHALL return an error indicating the minimum password length requirement
4. THE Auth_Service SHALL never store, log, or return the plaintext password in any response or system output

### Requirement 3: Authenticate and obtain a token

**User Story:** As a User, I want to authenticate with my email and password, so that I can obtain a token for my MCP server to use.

#### Acceptance Criteria

1. WHEN the User submits valid email and password credentials, THE Auth_Service SHALL return an Auth_Token
2. WHEN the User authenticates successfully, THE Auth_Service SHALL issue an Auth_Token with a minimum validity of 30 days
3. IF the User submits an incorrect password, THEN THE Auth_Service SHALL return an error indicating invalid credentials without specifying whether the email or password was wrong
4. IF the User submits an email that does not match any account, THEN THE Auth_Service SHALL return an error indicating invalid credentials without specifying whether the email or password was wrong
5. WHEN an Auth_Token is issued, THE Auth_Service SHALL include the User's unique identifier in the token payload

### Requirement 4: Store token locally for MCP server usage

**User Story:** As a User, I want my authentication token to be stored locally after login, so that my MCP server can use it without requiring me to log in again.

#### Acceptance Criteria

1. WHEN the User authenticates successfully, THE MCP_Server SHALL store the Auth_Token in the Credentials_File on the User's local filesystem
2. THE MCP_Server SHALL set file permissions on the Credentials_File to owner-read-only (mode 0600)
3. WHEN the MCP_Server starts, THE MCP_Server SHALL read the Auth_Token from the Credentials_File
4. IF the Credentials_File does not exist at startup, THEN THE MCP_Server SHALL return an error indicating the User must authenticate first

### Requirement 5: Authenticate MCP tool requests using the stored token

**User Story:** As a User, I want all my LLM conversations to access my notes without re-authentication, so that the experience is seamless across sessions.

#### Acceptance Criteria

1. WHEN the MCP_Server receives a tool call from the LLM, THE MCP_Server SHALL include the Auth_Token in the request to the Auth_Service
2. WHEN the Auth_Service receives a request with a valid Auth_Token, THE Auth_Service SHALL identify the User and authorize the request
3. IF the Auth_Service receives a request with an expired Auth_Token, THEN THE Auth_Service SHALL return an error indicating the token has expired and the User must re-authenticate
4. IF the Auth_Service receives a request with an invalid or malformed Auth_Token, THEN THE Auth_Service SHALL return an error indicating invalid authentication
5. IF the Auth_Service receives a request without any Auth_Token, THEN THE Auth_Service SHALL return an error indicating authentication is required

### Requirement 6: Isolate user data

**User Story:** As a User, I want to see only my own notes, so that my data remains private and separate from other users.

#### Acceptance Criteria

1. WHEN the Auth_Service authorizes a request, THE Auth_Service SHALL scope all data access to the authenticated User's unique identifier
2. THE Auth_Service SHALL reject any request that attempts to access resources belonging to a different User
3. IF a request targets a resource that does not belong to the authenticated User, THEN THE Auth_Service SHALL return a not-found error without revealing the resource exists for another User

### Requirement 7: Provide clear authentication error messages

**User Story:** As a User, I want clear error messages when authentication fails, so that the LLM can explain what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN an authentication error occurs, THE Auth_Service SHALL return a structured error response containing an error code and a human-readable message
2. THE Auth_Service SHALL include an actionable remedy in each authentication error message (e.g., "run the login command to re-authenticate")
3. IF the Auth_Token has expired, THEN THE Auth_Service SHALL return error code AUTH_TOKEN_EXPIRED with a message instructing the User to re-authenticate
4. IF the Auth_Token is missing, THEN THE Auth_Service SHALL return error code AUTH_REQUIRED with a message instructing the User to authenticate
5. IF the credentials are invalid during login, THEN THE Auth_Service SHALL return error code AUTH_INVALID_CREDENTIALS with a message indicating the email or password is incorrect

### Requirement 8: Rate-limit authentication attempts

**User Story:** As a User, I want my account protected from brute-force attacks, so that unauthorized parties cannot guess my password.

#### Acceptance Criteria

1. WHEN more than 5 failed login attempts occur for a single email within a 15-minute window, THE Auth_Service SHALL temporarily block further login attempts for that email
2. WHILE login attempts are blocked for an email, THE Auth_Service SHALL return an error indicating too many failed attempts and the remaining wait time
3. WHEN the blocking period of 15 minutes expires, THE Auth_Service SHALL allow login attempts again for that email
