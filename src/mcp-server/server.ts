import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createCredentialStore } from './storage/credentials.js';
import { validateEmail } from './validators/email.js';
import { validatePassword } from './validators/password.js';
import { mapCognitoError, authRequiredError, tokenExpiredError } from './errors/mapper.js';
import { refreshTokenIfNeeded } from './auth/refresh.js';
import type { McpNotesConfig } from '../types/config.js';

export interface McpNotesServerDeps {
  config: McpNotesConfig;
  cognitoClient?: CognitoIdentityProviderClient;
}

export function createMcpNotesServer(deps: McpNotesServerDeps) {
  const { config } = deps;
  const cognitoClient =
    deps.cognitoClient ??
    new CognitoIdentityProviderClient({ region: config.region });

  const credentialStore = createCredentialStore();

  const server = new McpServer({
    name: 'mcp-notes',
    version: '1.0.0',
  });

  // ─── Register Tool ─────────────────────────────────────────────────
  server.tool(
    'mcp_notes_register',
    'Create a new mcp-notes account with email and password',
    {
      email: z.string().describe('Your email address'),
      password: z.string().describe('Your password (minimum 8 characters)'),
    },
    async ({ email, password }) => {
      // Client-side validation
      if (!validateEmail(email)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid email format. Please provide a valid email address (e.g., user@example.com).',
            },
          ],
          isError: true,
        };
      }

      const pwResult = validatePassword(password);
      if (!pwResult.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `${pwResult.error!.message}\n\nWhat to do: ${pwResult.error!.remedy}`,
            },
          ],
          isError: true,
        };
      }

      try {
        await cognitoClient.send(
          new SignUpCommand({
            ClientId: config.cognitoClientId,
            Username: email,
            Password: password,
            UserAttributes: [{ Name: 'email', Value: email }],
          }),
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: 'Account created successfully. You can now log in with mcp_notes_login.',
            },
          ],
        };
      } catch (error) {
        const mapped = mapCognitoError(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Registration error: ${mapped.message}\n\nWhat to do: ${mapped.remedy}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── Login Tool ────────────────────────────────────────────────────
  server.tool(
    'mcp_notes_login',
    'Authenticate with email and password to obtain access tokens',
    {
      email: z.string().describe('Your email address'),
      password: z.string().describe('Your password'),
    },
    async ({ email, password }) => {
      if (!validateEmail(email)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid email format. Please provide a valid email address.',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await cognitoClient.send(
          new InitiateAuthCommand({
            ClientId: config.cognitoClientId,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
              USERNAME: email,
              PASSWORD: password,
            },
          }),
        );

        const auth = result.AuthenticationResult;
        if (!auth?.IdToken || !auth?.RefreshToken || !auth?.AccessToken) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Authentication succeeded but tokens were not returned. Please try again.',
              },
            ],
            isError: true,
          };
        }

        await credentialStore.save({
          idToken: auth.IdToken,
          refreshToken: auth.RefreshToken,
          accessToken: auth.AccessToken,
          expiresAt: Math.floor(Date.now() / 1000) + (auth.ExpiresIn ?? 3600),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: 'Authenticated successfully. Your session is stored locally.',
            },
          ],
        };
      } catch (error) {
        const mapped = mapCognitoError(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Login error: ${mapped.message}\n\nWhat to do: ${mapped.remedy}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── Logout Tool ───────────────────────────────────────────────────
  server.tool(
    'mcp_notes_logout',
    'Delete local credentials and end the session',
    {},
    async () => {
      await credentialStore.delete();
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Logged out successfully. Local credentials have been deleted.',
          },
        ],
      };
    },
  );

  // ─── Status Tool ───────────────────────────────────────────────────
  server.tool(
    'mcp_notes_status',
    'Check authentication status and refresh token if needed',
    {},
    async () => {
      const tokens = await credentialStore.load();
      if (!tokens) {
        const err = authRequiredError();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Not authenticated. ${err.remedy}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const refreshed = await refreshTokenIfNeeded(
          credentialStore,
          cognitoClient,
          config.cognitoClientId,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: refreshed
                ? 'Authenticated (token was refreshed).'
                : 'Authenticated (session is valid).',
            },
          ],
        };
      } catch {
        const err = tokenExpiredError();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Session expired. ${err.remedy}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ─── Main entry point ──────────────────────────────────────────────────
async function main() {
  const config: McpNotesConfig = {
    cognitoClientId: process.env.COGNITO_CLIENT_ID ?? '',
    apiGatewayUrl: process.env.API_GATEWAY_URL ?? '',
    region: process.env.AWS_REGION ?? 'eu-west-1',
  };

  if (!config.cognitoClientId) {
    console.error(
      'COGNITO_CLIENT_ID environment variable is required. Set it from CDK output.',
    );
    process.exit(1);
  }

  const server = createMcpNotesServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run if this file is executed directly
const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
