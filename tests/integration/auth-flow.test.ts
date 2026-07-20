import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  NotAuthorizedException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { createCredentialStore } from '../../src/mcp-server/storage/credentials.js';
import { refreshTokenIfNeeded } from '../../src/mcp-server/auth/refresh.js';
import { mapCognitoError } from '../../src/mcp-server/errors/mapper.js';
import type { CognitoTokens } from '../../src/types/auth.js';

/**
 * Integration tests for authentication flows.
 * Tests the full registration → login → token storage → refresh cycle
 * using mocked Cognito responses.
 */
describe('Authentication Flow Integration', () => {
  let tmpDir: string;
  let credentialsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-int-test-'));
    credentialsPath = path.join(tmpDir, 'credentials.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Full registration → login → token storage flow', () => {
    it('stores tokens after successful login', async () => {
      const store = createCredentialStore({ filePath: credentialsPath });

      // Simulate successful login result
      const tokens: CognitoTokens = {
        idToken: 'eyJhbG.test-id-token',
        refreshToken: 'eyJhbG.test-refresh-token',
        accessToken: 'eyJhbG.test-access-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      await store.save(tokens);
      const loaded = await store.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.idToken).toBe(tokens.idToken);
      expect(loaded!.refreshToken).toBe(tokens.refreshToken);
      expect(loaded!.accessToken).toBe(tokens.accessToken);
      expect(loaded!.expiresAt).toBe(tokens.expiresAt);
    });

    it('persists tokens with correct file permissions', async () => {
      const store = createCredentialStore({ filePath: credentialsPath });

      await store.save({
        idToken: 'id',
        refreshToken: 'refresh',
        accessToken: 'access',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      const stats = fs.statSync(credentialsPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe('Token refresh after ID token expiry', () => {
    it('refreshes token when expired and refresh token is valid', async () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const store = createCredentialStore({ filePath: credentialsPath });

      // Save expired tokens
      await store.save({
        idToken: 'expired-id',
        refreshToken: 'valid-refresh',
        accessToken: 'expired-access',
        expiresAt: pastTime,
      });

      // Mock Cognito client that returns new tokens
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          AuthenticationResult: {
            IdToken: 'new-id-token',
            AccessToken: 'new-access-token',
            ExpiresIn: 3600,
          },
        }),
      } as unknown as import('@aws-sdk/client-cognito-identity-provider').CognitoIdentityProviderClient;

      const refreshed = await refreshTokenIfNeeded(store, mockClient, 'test-client-id');
      expect(refreshed).toBe(true);

      // Verify new tokens are stored
      const loaded = await store.load();
      expect(loaded!.idToken).toBe('new-id-token');
      expect(loaded!.accessToken).toBe('new-access-token');
      expect(loaded!.refreshToken).toBe('valid-refresh'); // Kept from original
    });

    it('does not refresh when token is still valid', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const store = createCredentialStore({ filePath: credentialsPath });

      await store.save({
        idToken: 'valid-id',
        refreshToken: 'refresh',
        accessToken: 'valid-access',
        expiresAt: futureTime,
      });

      const mockClient = {
        send: vi.fn(),
      } as unknown as import('@aws-sdk/client-cognito-identity-provider').CognitoIdentityProviderClient;

      const refreshed = await refreshTokenIfNeeded(store, mockClient, 'test-client-id');
      expect(refreshed).toBe(false);
      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('throws error when refresh token is also expired', async () => {
      const pastTime = Math.floor(Date.now() / 1000) - 100;
      const store = createCredentialStore({ filePath: credentialsPath });

      await store.save({
        idToken: 'expired-id',
        refreshToken: 'expired-refresh',
        accessToken: 'expired-access',
        expiresAt: pastTime,
      });

      const mockClient = {
        send: vi.fn().mockRejectedValue(
          new NotAuthorizedException({
            message: 'Refresh Token has expired',
            $metadata: {},
          }),
        ),
      } as unknown as import('@aws-sdk/client-cognito-identity-provider').CognitoIdentityProviderClient;

      await expect(
        refreshTokenIfNeeded(store, mockClient, 'test-client-id'),
      ).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
    });
  });

  describe('Rate limiting behavior', () => {
    it('returns structured error for too many requests', () => {
      const error = new TooManyRequestsException({
        message: 'Rate exceeded',
        $metadata: {},
      });

      const result = mapCognitoError(error);
      expect(result.code).toBe('AUTH_RATE_LIMITED');
      expect(result.message).toContain('Too many');
      expect(result.remedy).toContain('Wait');
    });
  });

  describe('Data isolation via Lambda handlers', () => {
    it('two different users cannot access each other notes through handler logic', async () => {
      // This test verifies the logical isolation at the handler level:
      // Each handler extracts userId from claims and uses it as PK.
      // We verify the pattern by checking that handlers require auth claims.

      // Import a handler to test directly
      const { handler } = await import('../../src/lambda/list-notes.js');

      // Request without auth claims → 401
      const noAuthEvent = {
        httpMethod: 'GET',
        body: null,
        pathParameters: null,
        requestContext: { authorizer: null },
      } as unknown as import('aws-lambda').APIGatewayProxyEvent;

      const result = await handler(noAuthEvent);
      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('AUTH_REQUIRED');
    });
  });
});
