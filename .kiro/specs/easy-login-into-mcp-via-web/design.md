# Design Document: Easy Login into MCP via Web

## Overview

This design enables users to authenticate their local MCP server through the web frontend, eliminating the need to type credentials directly in Claude Desktop. The approach uses a **temporary localhost HTTP server** embedded within the MCP server process that receives tokens from the web frontend after a successful Cognito login.

**Key insight**: Node.js's async event loop allows the MCP server to maintain its stdio transport (for Claude Desktop) AND simultaneously run an HTTP server on localhost. These are independent I/O mechanisms and coexist without conflict.

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Web Login Token Bridge Flow                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     1. User asks to login via web                         │
│  │Claude Desktop│─────────────────────────────┐                             │
│  │  (MCP Host)  │                             │                             │
│  └──────────────┘                             ▼                             │
│        │                          ┌───────────────────┐                     │
│        │ stdio                    │  MCP Server Tool   │                     │
│        ▼                          │ mcp_notes_web_login│                     │
│  ┌──────────────┐                 └─────────┬─────────┘                     │
│  │  MCP Server  │                           │                               │
│  │  (Node.js)   │  2. Starts Local Auth     │                               │
│  │              │     Server on port 9876   │                               │
│  │  ┌────────┐  │◄─────────────────────────┘                               │
│  │  │Local   │  │  3. Returns URL to user:                                  │
│  │  │Auth Srv│  │     "Visit https://d3ozm.../login?port=9876"              │
│  │  │:9876   │  │                                                           │
│  │  └────┬───┘  │                                                           │
│  └───────│──────┘                                                           │
│          │                                                                  │
│          │         ┌──────────────────────────────────────┐                 │
│          │         │         Web Frontend (CloudFront)     │                 │
│          │         │                                       │                 │
│          │         │  4. User opens URL, sees login form   │                 │
│          │         │  5. Submits email + password           │                 │
│          │         │  6. Frontend authenticates with        │                 │
│          │         │     Cognito (USER_PASSWORD_AUTH)       │                 │
│          │         │  7. Receives tokens from Cognito       │                 │
│          │         │                                       │                 │
│          │◄────────│  8. POST tokens to                    │                 │
│          │         │     http://localhost:9876/auth/callback│                 │
│          │         └──────────────────────────────────────┘                 │
│          │                                                                  │
│          ▼                                                                  │
│  9. Local Auth Server:                                                      │
│     - Validates token payload                                               │
│     - Writes to ~/.mcp-notes/credentials.json (mode 0o600)                 │
│     - Responds with success HTML                                            │
│     - Shuts down                                                            │
│                                                                             │
│  10. Next MCP tool call uses stored credentials automatically               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────┐
│               MCP Server Process                 │
│                                                  │
│  ┌──────────────────┐  ┌─────────────────────┐  │
│  │  MCP Protocol    │  │  Local Auth Server   │  │
│  │  (stdio)         │  │  (HTTP, localhost)   │  │
│  │                  │  │                      │  │
│  │  - register      │  │  POST /auth/callback │  │
│  │  - login         │  │  GET  /auth/status   │  │
│  │  - web_login ◄───┼──┼── starts/stops       │  │
│  │  - logout        │  │                      │  │
│  │  - status        │  │                      │  │
│  │  - notes CRUD    │  │                      │  │
│  └──────────────────┘  └──────────┬───────────┘  │
│                                   │              │
│           ┌───────────────────────┘              │
│           ▼                                      │
│  ┌──────────────────┐                            │
│  │ Credential Store │                            │
│  │ ~/.mcp-notes/    │                            │
│  │ credentials.json │                            │
│  └──────────────────┘                            │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│          Web Frontend (CloudFront)               │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Signup  │  │  Login   │  │ Token Delivery │  │
│  │  Flow    │  │  Form    │  │ (POST to       │  │
│  │          │  │          │  │  localhost)     │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where does Local Auth Server run? | In the MCP server process | Node.js event loop handles both stdio and HTTP. No child process complexity. |
| How are tokens transferred? | POST request from frontend to localhost | Avoids token leakage in URLs/browser history (Req 5.3). CORS headers on local server allow the CloudFront origin. |
| When does the local server start? | On-demand via `mcp_notes_web_login` tool | Minimizes attack surface — server only runs during login flow. |
| Fixed or random port? | Fixed port 9876 (configurable) | Simpler — the frontend needs to know the port. Passed as query param `?port=`. |
| How does MCP server detect new creds? | Re-reads file on every API call | Already the current behavior (load from disk each time). No file watcher needed. |
| One-shot or persistent server? | One-shot (shuts down after success) | Minimizes attack surface, prevents replay (Req 5.5). |

## Components and Interfaces

### 1. Local Auth Server (`src/mcp-server/auth/local-auth-server.ts`)

A lightweight HTTP server that:
- Binds to `127.0.0.1` on the configured port
- Accepts a single POST with tokens
- Validates, persists, and shuts down

```typescript
export interface LocalAuthServerOptions {
  port: number;
  credentialStore: CredentialStore;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  /** Timeout in ms before auto-shutdown if no request received */
  timeout?: number;
}

export interface LocalAuthServer {
  /** Start listening. Resolves when the server is ready. */
  start(): Promise<void>;
  /** Stop the server (called automatically after success). */
  stop(): Promise<void>;
  /** Whether the server has already received tokens. */
  hasReceivedTokens(): boolean;
  /** The port the server is listening on. */
  getPort(): number;
}

export function createLocalAuthServer(
  options: LocalAuthServerOptions
): LocalAuthServer;
```

**Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/callback` | Receives token payload, validates, persists, returns success HTML |
| `GET` | `/auth/status` | Returns whether the server is waiting for tokens (used by frontend for polling) |

**CORS Configuration:**
- `Access-Control-Allow-Origin: *` (any origin can POST — localhost is the security boundary)
- `Access-Control-Allow-Methods: POST, GET, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

### 2. Web Login MCP Tool (`mcp_notes_web_login`)

A new MCP tool that orchestrates the web login flow:

```typescript
// Registered on the MCP server
server.tool(
  'mcp_notes_web_login',
  'Start web-based login flow. Opens a local server and provides a URL for the user to authenticate via the web frontend.',
  {
    port: z.number().optional().describe('Local server port (default: 9876)'),
  },
  async ({ port = 9876 }) => { /* ... */ }
);
```

**Behavior:**
1. Check if a local auth server is already running → error if so
2. Start the local auth server on the specified port
3. Return a message with the frontend login URL
4. Set a timeout (5 minutes) after which the server auto-shuts down
5. The server shuts down automatically after receiving valid tokens

### 3. Frontend Login Page (`src/frontend/components/LoginForm.tsx`)

A new React component for the login flow:

```typescript
interface LoginFormProps {
  /** The localhost port to send tokens to (from URL query param) */
  callbackPort: number | null;
  onLoginSuccess: () => void;
  onLoginError: (error: string) => void;
}
```

**Behavior:**
1. Renders email + password form
2. If `callbackPort` is present in URL, shows "This will authenticate your MCP server"
3. On submit: calls Cognito `InitiateAuth` with `USER_PASSWORD_AUTH`
4. On success: POSTs tokens to `http://localhost:{callbackPort}/auth/callback`
5. Shows success/error message based on POST response

### 4. Frontend Auth Service Extension (`src/frontend/services/auth-service.ts`)

Add a `login` function alongside the existing `signUp` and `confirmSignUp`:

```typescript
export interface LoginResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult>;

export async function deliverTokensToLocalServer(
  tokens: LoginResult,
  port: number,
): Promise<void>;
```

### 5. Frontend App Routing (`src/frontend/App.tsx`)

The App component needs to handle the login flow. Since there's no router, use URL query params:

- `?action=login&port=9876` → show login form with MCP callback
- Default (no params) → show signup/confirm flow (existing)

```typescript
type AppStep = 'signup' | 'confirm' | 'success' | 'login' | 'login-success' | 'login-error';
```

## Data Models

### Token Payload (POST body to `/auth/callback`)

```typescript
interface TokenCallbackPayload {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until expiry
}
```

### Credential Store Format (unchanged)

```typescript
// ~/.mcp-notes/credentials.json
interface StoredCredentials {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Unix timestamp (seconds)
  savedAt: string;    // ISO 8601
}
```

### Local Auth Server Response

**Success (200):**
```json
{
  "status": "ok",
  "message": "Tokens received and stored. You can close this page and return to Claude Desktop."
}
```

The response also serves an HTML page for the browser redirect case.

**Validation Error (400):**
```json
{
  "status": "error",
  "message": "Invalid token payload: missing required field 'refreshToken'"
}
```

**Already Received (409):**
```json
{
  "status": "error",
  "message": "Tokens have already been received for this session. Start a new web login flow if needed."
}
```

## Error Handling

| Scenario | Component | Behavior |
|----------|-----------|----------|
| Local port already in use | Local Auth Server | Return error from `mcp_notes_web_login` tool with suggestion to use a different port |
| Timeout (5 min, no tokens received) | Local Auth Server | Auto-shutdown, log timeout. Next `web_login` call starts fresh. |
| Malformed token payload | Local Auth Server | Return 400 with descriptive error. Do NOT shut down (user might retry). |
| Cognito auth fails | Frontend | Display Cognito error message (existing `mapCognitoError` pattern) |
| POST to localhost fails (server not running) | Frontend | Display error: "MCP server is not running or not waiting for login. Make sure Claude Desktop is open and you've asked it to start web login." |
| POST to localhost fails (CORS/network) | Frontend | Same error message as above with additional "Check that port {port} is correct." |
| Credential file write fails (permissions) | Local Auth Server | Return 500 error, log to stderr. |
| Duplicate token submission | Local Auth Server | Return 409, do not overwrite. Server stays shut down. |

### Error Recovery

- If the local server times out, the user simply re-invokes `mcp_notes_web_login`
- If the frontend POST fails, the user can retry the login (tokens remain valid for their 1-hour window)
- The `mcp_notes_web_login` tool checks for and stops any existing stale server instance before starting a new one

## Testing Strategy

### Assessment: Property-Based Testing NOT Applicable

This feature is primarily composed of:
- HTTP server setup and request handling (I/O)
- UI rendering (React components)
- Integration with Cognito (external service)
- File system writes (side effects)

None of these have pure-function behavior with a large input space that would benefit from 100+ random iterations. The validation logic (token field checking) is simple enough that example-based tests cover the space completely.

### Unit Tests

| Component | Test Cases |
|-----------|-----------|
| `createLocalAuthServer` | Binds to 127.0.0.1, responds to POST with valid tokens, rejects malformed payloads, returns 409 on duplicate, auto-shuts down after success, auto-shuts down on timeout |
| `validateTokenPayload` | Valid payload passes, missing fields rejected, wrong types rejected, empty strings rejected |
| `LoginForm` component | Renders fields, submits credentials, shows errors, shows MCP context message when port is present |
| `deliverTokensToLocalServer` | Calls fetch with POST + correct body, handles success, handles network error |
| `mcp_notes_web_login` tool | Returns URL with correct port, handles port-in-use error, handles timeout |

### Integration Tests

| Flow | Description |
|------|-------------|
| Full token bridge | Start local server → POST tokens → verify credentials.json written correctly |
| Frontend login + delivery | Mock Cognito → login → verify POST to localhost is triggered |
| MCP tool → credential pickup | Write credentials via local server → call notes tool → verify tokens are used |

### Test Framework

- **Unit tests**: Vitest (already configured) with `@testing-library/react` for components
- **HTTP testing**: Use Node.js `http` module directly in tests (no need for supertest for a simple localhost server)
- **Mocking**: Vitest's built-in mocking for Cognito SDK and fetch

## Notes

- The Local Auth Server uses Node.js built-in `node:http` module — no additional dependency needed
- The frontend build (esbuild) already handles TSX and the new login components will be bundled automatically
- The `?action=login&port=9876` URL pattern avoids the need for a router library
- CORS `Access-Control-Allow-Origin: *` on the local server is acceptable because the security boundary is the loopback interface binding, not origin checking
