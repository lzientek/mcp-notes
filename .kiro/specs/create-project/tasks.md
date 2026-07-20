# Implementation Plan: User Authentication

## Overview

This plan implements the mcp-notes authentication system as a fully serverless TypeScript project using AWS CDK, Cognito, API Gateway, Lambda, and DynamoDB. The MCP server runs locally using `@modelcontextprotocol/sdk` and communicates with AWS services for auth and data operations. Tasks are ordered to build foundational modules first (validators, credential store, error mapping), then infrastructure (CDK), then application logic (MCP tools, Lambdas), and finally tests.

## Tasks

- [x] 1. Initialize project structure and core interfaces
  - [x] 1.1 Set up TypeScript project with CDK and dependencies
    - Initialize npm project with TypeScript
    - Install dependencies: `aws-cdk-lib`, `constructs`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@modelcontextprotocol/sdk`, `ulid`
    - Install dev dependencies: `vitest`, `fast-check`, `typescript`, `ts-node`, `aws-cdk`, `@types/node`, `memfs`
    - Configure `tsconfig.json` with strict mode, ES2022 target, NodeNext module resolution
    - Configure `vitest.config.ts`
    - Set up CDK app entry point (`bin/mcp-notes.ts`)
    - Create directory structure: `src/mcp-server/`, `src/lambda/`, `lib/`, `tests/unit/`, `tests/integration/`, `tests/cdk/`
    - _Requirements: N/A (project setup)_

  - [x] 1.2 Define core interfaces and types
    - Create `src/types/auth.ts` with `CognitoTokens`, `AuthErrorResponse` interfaces
    - Create `src/types/notes.ts` with `Note` interface (userId, noteId, title, content, createdAt, updatedAt)
    - Create `src/types/config.ts` with configuration interface (Cognito Client ID, API Gateway URL)
    - _Requirements: 4.1, 7.1_

- [x] 2. Implement input validators
  - [x] 2.1 Create email and password validation functions
    - Create `src/mcp-server/validators/email.ts` with `validateEmail(input: string): boolean`
    - Validate: exactly one `@`, non-empty local part, non-empty domain with at least one dot
    - Create `src/mcp-server/validators/password.ts` with `validatePassword(input: string): { valid: boolean; error?: AuthErrorResponse }`
    - Validate: minimum 8 characters, return structured error on failure
    - _Requirements: 1.4, 1.5, 2.2, 2.3_

  - [x]* 2.2 Write property test for email validation (Property 1)
    - **Property 1: Email validation correctness**
    - For any string, `validateEmail` accepts iff it matches `local-part@domain` pattern (one `@`, non-empty local, non-empty domain with dot)
    - Use `fc.string()` and `fc.emailAddress()` arbitraries
    - **Validates: Requirements 1.4**

  - [x]* 2.3 Write property test for password validation (Property 2)
    - **Property 2: Password length validation**
    - For any string < 8 chars, `validatePassword` returns `{ valid: false }` with VALIDATION_ERROR code
    - For any string >= 8 chars, `validatePassword` returns `{ valid: true }`
    - Use `fc.string({ minLength: 0, maxLength: 7 })` and `fc.string({ minLength: 8, maxLength: 128 })`
    - **Validates: Requirements 2.2, 2.3**

- [x] 3. Implement credential storage module
  - [x] 3.1 Create CredentialStore with save, load, delete, isExpired
    - Create `src/mcp-server/storage/credentials.ts`
    - Implement `save(tokens: CognitoTokens): Promise<void>` — write JSON to `~/.mcp-notes/credentials.json`, set mode 0600, create directory if needed
    - Implement `load(): Promise<CognitoTokens | null>` — read and parse file, return null if missing or malformed
    - Implement `delete(): Promise<void>` — remove credentials file
    - Implement `getPath(): string` — return resolved path to credentials file
    - Implement `isExpired(tokens: CognitoTokens): boolean` — compare `expiresAt` to current time
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 3.2 Write property test for credential file round-trip (Property 3)
    - **Property 3: Credential file round-trip**
    - For any valid `CognitoTokens` object, `save(tokens)` then `load()` returns identical field values
    - Use `memfs` or temp directory to mock filesystem
    - Generate arbitrary tokens with `fc.record({ idToken: fc.string({minLength:1}), refreshToken: fc.string({minLength:1}), accessToken: fc.string({minLength:1}), expiresAt: fc.nat() })`
    - **Validates: Requirements 4.1**

  - [x]* 3.3 Write property test for credential file permissions (Property 4)
    - **Property 4: Credential file permissions invariant**
    - For any call to `save(tokens)`, the resulting file has Unix permissions 0600
    - Use real temp directory (memfs may not support permissions)
    - **Validates: Requirements 4.2**

  - [x]* 3.4 Write property test for token expiration detection (Property 8)
    - **Property 8: Token expiration detection**
    - For any `CognitoTokens` where `expiresAt < now`, `isExpired` returns true
    - For any `CognitoTokens` where `expiresAt > now`, `isExpired` returns false
    - Use injectable clock for deterministic testing
    - **Validates: Requirements 5.3**

- [x] 4. Implement error mapping module
  - [x] 4.1 Create Cognito error mapper with structured responses
    - Create `src/mcp-server/errors/mapper.ts`
    - Implement `mapCognitoError(error: unknown): AuthErrorResponse`
    - Map `UsernameExistsException` → `EMAIL_ALREADY_EXISTS`
    - Map `NotAuthorizedException` and `UserNotFoundException` → `AUTH_INVALID_CREDENTIALS` (same error for both, no info leak)
    - Map `TooManyRequestsException` → `AUTH_RATE_LIMITED`
    - Map `InvalidPasswordException` → `VALIDATION_ERROR`
    - Map `InvalidParameterException` → `VALIDATION_ERROR`
    - Map expired token scenario → `AUTH_TOKEN_EXPIRED`
    - Map missing token → `AUTH_REQUIRED`
    - Each error includes `code`, `message`, and actionable `remedy`
    - _Requirements: 3.3, 3.4, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 4.2 Write property test for error mapping completeness (Property 5)
    - **Property 5: Error mapping completeness**
    - For any Cognito exception type, `mapCognitoError` returns an object with all three fields: non-empty `code`, non-empty `message`, non-empty `remedy` with actionable instruction
    - Enumerate all known exception types as test input
    - **Validates: Requirements 7.1, 7.2**

  - [x]* 4.3 Write property test for error mapping non-leakage (Property 6)
    - **Property 6: Error mapping does not leak credential distinction**
    - For `NotAuthorizedException` (wrong password) and `UserNotFoundException` (unknown email), the mapped error code is identical (`AUTH_INVALID_CREDENTIALS`) and message does not reveal which field was wrong
    - Assert message does not contain "email not found", "user not found", "wrong password" or similar distinguishing phrases
    - **Validates: Requirements 3.3, 3.4**

- [x] 5. Checkpoint - Core modules complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement CDK infrastructure stack
  - [x] 6.1 Create CDK stack with Cognito User Pool, DynamoDB table, and PreSignUp Lambda
    - Create `lib/mcp-notes-stack.ts`
    - Define Cognito User Pool: `selfSignUpEnabled: true`, `signInAliases: { email: true }`, password policy `minLength: 8` (no uppercase/digits/symbols required), `accountRecovery: NONE`, `removalPolicy: RETAIN`
    - Define PreSignUp Lambda trigger: auto-confirm user, auto-verify email
    - Define User Pool Client: `userPassword` auth flow, no secret, ID token 1h, refresh token 90 days, access token 1h
    - Define DynamoDB table: partition key `userId` (S), sort key `noteId` (S), billing mode PAY_PER_REQUEST
    - _Requirements: 1.1, 2.1, 2.2, 3.2, 6.1_

  - [x] 6.2 Add API Gateway with Cognito Authorizer and Lambda integrations
    - Define REST API with `prod` stage
    - Create Cognito User Pools Authorizer
    - Create Lambda functions for notes CRUD (listNotes, createNote, getNote, updateNote, deleteNote)
    - Grant DynamoDB read/write permissions to Lambda functions
    - Wire endpoints: GET/POST `/notes`, GET/PUT/DELETE `/notes/{noteId}` with Cognito authorization
    - Add CDK Outputs for API URL and Cognito Client ID
    - _Requirements: 5.1, 5.2, 6.1_

  - [x] 6.3 Implement PreSignUp Lambda trigger
    - Create `src/lambda/pre-sign-up.ts`
    - Set `event.response.autoConfirmUser = true`
    - Set `event.response.autoVerifyEmail = true`
    - Return modified event
    - _Requirements: 1.1 (auto-confirm for frictionless registration)_

  - [x] 6.4 Implement notes CRUD Lambda functions
    - Create `src/lambda/list-notes.ts` — Query DynamoDB with `userId` as PK
    - Create `src/lambda/create-note.ts` — PutItem with `userId` + ULID noteId
    - Create `src/lambda/get-note.ts` — GetItem with `userId` + `noteId`, return 404 if not found
    - Create `src/lambda/update-note.ts` — PutItem with condition on `userId` match
    - Create `src/lambda/delete-note.ts` — DeleteItem with `userId` + `noteId`
    - Extract `userId` from `event.requestContext.authorizer.claims.sub` in all handlers
    - Return structured error responses for missing auth or not-found cases
    - _Requirements: 5.2, 6.1, 6.2, 6.3_

  - [x]* 6.5 Write property test for data isolation (Property 7)
    - **Property 7: Data isolation via partition key**
    - For any Lambda invocation with a given `userId` in claims, every DynamoDB operation constructed by the handler uses that `userId` as partition key
    - Mock DynamoDB DocumentClient, intercept constructed commands, verify PK matches claims.sub
    - No operation references a different user's partition
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 7. Implement MCP Server tools
  - [x] 7.1 Create MCP server with register, login, logout, and status tools
    - Create `src/mcp-server/server.ts` using `@modelcontextprotocol/sdk`
    - Implement `mcp_notes_register(email, password)`: validate inputs → call Cognito SignUp → return success or mapped error
    - Implement `mcp_notes_login(email, password)`: validate inputs → call Cognito InitiateAuth (USER_PASSWORD_AUTH) → save tokens via CredentialStore → return success or mapped error
    - Implement `mcp_notes_logout()`: delete credentials file via CredentialStore
    - Implement `mcp_notes_status()`: load tokens → check expiration → attempt refresh if expired → return auth status
    - Wire error handling with `mapCognitoError` for all Cognito operations
    - Format errors as MCP tool error results with `isError: true`
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 3.4, 4.1, 4.4, 7.1, 7.2_

  - [x] 7.2 Implement token refresh logic
    - Create `src/mcp-server/auth/refresh.ts`
    - Implement `refreshTokenIfNeeded(store: CredentialStore): Promise<CognitoTokens>`
    - If ID token is expired but refresh token exists, call Cognito InitiateAuth with `REFRESH_TOKEN_AUTH`
    - On success: update stored tokens (new IdToken + AccessToken, keep RefreshToken)
    - On failure (refresh token also expired): throw error mapped to `AUTH_TOKEN_EXPIRED`
    - Integrate into MCP tool calls that require authentication (status, future note operations)
    - _Requirements: 3.2, 5.3, 7.3_

  - [x]* 7.3 Write unit tests for MCP server tools
    - Test registration with valid inputs returns success
    - Test registration with existing email returns EMAIL_ALREADY_EXISTS error
    - Test login with valid credentials stores tokens and returns success
    - Test login with invalid credentials returns AUTH_INVALID_CREDENTIALS
    - Test logout deletes credentials file
    - Test status with no credentials returns AUTH_REQUIRED
    - Test status with expired token triggers refresh
    - Test token refresh with expired refresh token returns AUTH_TOKEN_EXPIRED
    - Mock Cognito client for all tests
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 4.4, 5.3, 7.3, 7.4_

- [x] 8. Checkpoint - Application code complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integration and infrastructure tests
  - [x]* 9.1 Write integration tests for auth flows
    - Test full registration → login → token storage flow
    - Test token refresh after ID token expiry (mock time)
    - Test rate limiting behavior (verify structured error after excessive attempts)
    - Test data isolation: create 2 users, verify no cross-access via Lambda handlers
    - _Requirements: 1.1, 3.1, 3.2, 5.3, 6.1, 6.2, 8.1, 8.2_

  - [x]* 9.2 Write CDK infrastructure assertion tests
    - Create `tests/cdk/stack.test.ts`
    - Assert Cognito UserPool has password policy with minLength 8
    - Assert DynamoDB table has correct key schema (userId PK, noteId SK)
    - Assert API Gateway has Cognito Authorizer of type COGNITO_USER_POOLS
    - Assert PreSignUp Lambda trigger is attached to User Pool
    - Assert Lambda functions have DynamoDB permissions
    - Assert User Pool Client has userPassword auth flow enabled
    - Assert refresh token validity is 90 days
    - _Requirements: 2.2, 3.2, 5.2, 6.1_

- [x] 10. Final checkpoint - All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations use TypeScript
- Cognito handles password hashing (SRP), rate limiting, and token management — no custom implementation needed for these
- The MCP server communicates directly with Cognito for auth operations (no API Gateway needed for signup/login)
- API Gateway + Cognito Authorizer handles token validation for note operations

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "4.3"] },
    { "id": 4, "tasks": ["6.1", "6.3"] },
    { "id": 5, "tasks": ["6.2", "6.4"] },
    { "id": 6, "tasks": ["6.5", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3", "9.2"] },
    { "id": 9, "tasks": ["9.1"] }
  ]
}
```
