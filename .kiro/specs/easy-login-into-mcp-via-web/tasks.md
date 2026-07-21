# Implementation Plan: Easy Login into MCP via Web

## Overview

This plan implements the web-based login flow for the MCP server. The approach adds a temporary localhost HTTP server inside the MCP process, a new `mcp_notes_web_login` tool, and the corresponding frontend login components. All code is TypeScript ESM; no new dependencies are required.

## Tasks

- [ ] 1. Implement Local Auth Server core module
  - [ ] 1.1 Create `src/mcp-server/auth/local-auth-server.ts` with `createLocalAuthServer` factory
    - Implement HTTP server using `node:http` that binds to `127.0.0.1`
    - Handle CORS preflight (OPTIONS) with `Access-Control-Allow-Origin: *`
    - Implement `POST /auth/callback` route: parse JSON body, validate token fields, write to credential store, respond with success HTML, then shutdown
    - Implement `GET /auth/status` route: return JSON indicating whether server is waiting for tokens
    - Implement one-shot guard: reject with 409 if tokens already received
    - Implement auto-shutdown timeout (default 5 minutes)
    - Export `LocalAuthServer` interface and `LocalAuthServerOptions` type as defined in design
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.1, 5.4, 5.5_

  - [ ] 1.2 Create `src/mcp-server/auth/validate-token-payload.ts` with `validateTokenPayload` function
    - Validate that the parsed body contains `idToken`, `accessToken`, `refreshToken` (all non-empty strings) and `expiresIn` (number > 0)
    - Return a discriminated union: `{ valid: true, tokens: TokenCallbackPayload }` or `{ valid: false, error: string }`
    - _Requirements: 5.4_

  - [ ]* 1.3 Write unit tests for `validateTokenPayload`
    - Test valid payload passes
    - Test missing fields rejected
    - Test wrong types rejected
    - Test empty strings rejected
    - _Requirements: 5.4_

  - [ ]* 1.4 Write unit tests for `createLocalAuthServer`
    - Test server binds to 127.0.0.1 and responds on the configured port
    - Test POST with valid payload writes credentials and returns 200
    - Test POST with malformed payload returns 400
    - Test duplicate POST returns 409
    - Test server auto-shuts down after successful token receipt
    - Test server auto-shuts down on timeout
    - Test GET /auth/status returns correct state
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.5_

- [ ] 2. Register `mcp_notes_web_login` MCP tool
  - [ ] 2.1 Add `mcp_notes_web_login` tool in `src/mcp-server/server.ts`
    - Register tool with zod schema: `port` (optional number, default 9876)
    - Implementation: check no existing local auth server running, start one, return URL message with `https://<cloudfront-domain>/login?port={port}`
    - Store the active server instance in a module-level variable for cleanup
    - Set 5-minute timeout on the server
    - On timeout: log and clean up reference
    - On success: clean up reference
    - _Requirements: 2.1, 6.1_

  - [ ]* 2.2 Write unit tests for `mcp_notes_web_login` tool
    - Test returns URL with correct port
    - Test returns error if server already running
    - Test cleans up on timeout
    - _Requirements: 2.1, 6.1_

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement frontend login function and token delivery
  - [ ] 4.1 Add `login` and `deliverTokensToLocalServer` functions to `src/frontend/services/auth-service.ts`
    - `login(email, password)`: call Cognito `InitiateAuth` with `USER_PASSWORD_AUTH`, return `{ idToken, accessToken, refreshToken, expiresIn }`
    - `deliverTokensToLocalServer(tokens, port)`: POST tokens as JSON to `http://localhost:{port}/auth/callback`, throw on non-200 response
    - _Requirements: 1.2, 3.1, 3.4_

  - [ ]* 4.2 Write unit tests for `login` and `deliverTokensToLocalServer`
    - Mock CognitoIdentityProviderClient to test `login` success and error paths
    - Mock global `fetch` to test `deliverTokensToLocalServer` success and network error paths
    - _Requirements: 1.2, 3.1, 3.3_

- [ ] 5. Implement frontend LoginForm component
  - [ ] 5.1 Create `src/frontend/components/LoginForm.tsx`
    - Render email and password fields with submit button
    - If `callbackPort` prop is provided, show informational text: "This will authenticate your local MCP server"
    - On submit: call `login()`, then call `deliverTokensToLocalServer()` with the port
    - Handle loading state, Cognito errors, and token delivery errors with appropriate messages
    - On delivery success: call `onLoginSuccess` callback
    - On delivery failure: display error with instructions to ensure MCP server is running
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2, 3.3, 6.2, 6.3, 6.4_

  - [ ] 5.2 Create `src/frontend/hooks/useLogin.ts`
    - Manage login state (isLoading, error, success)
    - Orchestrate `login` → `deliverTokensToLocalServer` sequence
    - _Requirements: 1.2, 3.1_

  - [ ]* 5.3 Write unit tests for `LoginForm` component
    - Test renders email and password fields
    - Test shows MCP context message when port is present
    - Test calls login on submit
    - Test shows error on invalid credentials
    - Test shows error when localhost delivery fails
    - Test shows success message on complete flow
    - _Requirements: 1.1, 1.3, 3.2, 3.3, 6.2_

- [ ] 6. Update frontend App routing and types
  - [ ] 6.1 Update `src/frontend/types.ts` to add `'login' | 'login-success' | 'login-error'` to `AppStep`
    - _Requirements: 1.1, 6.2_

  - [ ] 6.2 Update `src/frontend/App.tsx` to handle `?action=login&port=9876` query params
    - On load: parse `URLSearchParams` from `window.location.search`
    - If `action=login` and `port` is present: set initial step to `'login'` and store port
    - Render `LoginForm` when step is `'login'`, `SuccessMessage` (with MCP-specific text) when `'login-success'`
    - Default behavior (no action param): existing signup/confirm flow unchanged
    - _Requirements: 1.1, 1.4, 6.2, 6.3_

- [ ] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Verify builds and integration
  - [ ] 8.1 Verify full TypeScript build passes (`npm run build`)
    - Ensure no type errors across mcp-server and frontend source
    - _Requirements: all_

  - [ ] 8.2 Verify frontend build passes (`npm run build:frontend`)
    - Ensure esbuild bundles the new login components without errors
    - _Requirements: all_

  - [ ]* 8.3 Write integration test for the full token bridge flow
    - Start local auth server on a random port
    - POST a valid token payload to `/auth/callback`
    - Verify `credentials.json` written with correct content and `0o600` permissions
    - Verify server shuts down after receiving tokens
    - _Requirements: 2.3, 2.4, 5.2, 5.5_

- [ ] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- No new dependencies needed: `node:http` is built-in, Cognito SDK and `fast-check` already present
- The credential store already writes with `mode: 0o600` — the local auth server reuses `createCredentialStore`
- The existing `mcp_notes_login` tool remains as a fallback for users who prefer CLI login

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "4.1", "6.1"] },
    { "id": 2, "tasks": ["2.1", "4.2", "5.2", "6.2"] },
    { "id": 3, "tasks": ["2.2", "5.1"] },
    { "id": 4, "tasks": ["5.3"] },
    { "id": 5, "tasks": ["8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3"] }
  ]
}
```
