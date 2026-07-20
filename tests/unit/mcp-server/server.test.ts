import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { validateEmail } from '../../../src/mcp-server/validators/email.js';
import { validatePassword } from '../../../src/mcp-server/validators/password.js';
import { mapCognitoError, authRequiredError, tokenExpiredError } from '../../../src/mcp-server/errors/mapper.js';
import { createCredentialStore } from '../../../src/mcp-server/storage/credentials.js';

/**
 * Unit tests for MCP server tool logic.
 * Tests the underlying functions that power the MCP tools.
 */
describe('MCP Server Tool Logic', () => {
  let tmpDir: string;
  let credentialsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-server-test-'));
    credentialsPath = path.join(tmpDir, 'credentials.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Registration validation', () => {
    it('rejects invalid email format', () => {
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
    });

    it('accepts valid email format', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user+tag@domain.co')).toBe(true);
    });

    it('rejects short passwords', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid passwords', () => {
      const result = validatePassword('securepassword123');
      expect(result.valid).toBe(true);
    });
  });

  describe('Registration error mapping', () => {
    it('maps UsernameExistsException to EMAIL_ALREADY_EXISTS', () => {
      const error = new UsernameExistsException({ message: 'User already exists', $metadata: {} });
      const result = mapCognitoError(error);
      expect(result.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(result.message).toContain('already exists');
      expect(result.remedy).toBeTruthy();
    });
  });

  describe('Login error mapping', () => {
    it('maps NotAuthorizedException to AUTH_INVALID_CREDENTIALS', () => {
      const error = new NotAuthorizedException({ message: 'Incorrect', $metadata: {} });
      const result = mapCognitoError(error);
      expect(result.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('maps UserNotFoundException to AUTH_INVALID_CREDENTIALS (same as wrong password)', () => {
      const error = new UserNotFoundException({ message: 'User not found', $metadata: {} });
      const result = mapCognitoError(error);
      expect(result.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('does not leak whether email or password was wrong', () => {
      const wrongPw = mapCognitoError(new NotAuthorizedException({ message: 'Incorrect', $metadata: {} }));
      const noUser = mapCognitoError(new UserNotFoundException({ message: 'Not found', $metadata: {} }));
      expect(wrongPw.code).toBe(noUser.code);
      expect(wrongPw.message).toBe(noUser.message);
    });
  });

  describe('Credential Store - Logout', () => {
    it('deletes the credentials file', async () => {
      const store = createCredentialStore({ filePath: credentialsPath });
      await store.save({
        idToken: 'id',
        refreshToken: 'refresh',
        accessToken: 'access',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(fs.existsSync(credentialsPath)).toBe(true);

      await store.delete();
      expect(fs.existsSync(credentialsPath)).toBe(false);
    });

    it('does not throw when credentials file does not exist', async () => {
      const store = createCredentialStore({ filePath: credentialsPath });
      await expect(store.delete()).resolves.not.toThrow();
    });
  });

  describe('Credential Store - Status', () => {
    it('returns null when no credentials exist', async () => {
      const store = createCredentialStore({ filePath: credentialsPath });
      const tokens = await store.load();
      expect(tokens).toBeNull();
    });

    it('detects expired token', () => {
      const fixedNow = 1000000;
      const store = createCredentialStore({
        filePath: credentialsPath,
        now: () => fixedNow,
      });
      const expired = store.isExpired({
        idToken: 'x',
        refreshToken: 'x',
        accessToken: 'x',
        expiresAt: fixedNow - 100,
      });
      expect(expired).toBe(true);
    });

    it('detects valid token', () => {
      const fixedNow = 1000000;
      const store = createCredentialStore({
        filePath: credentialsPath,
        now: () => fixedNow,
      });
      const expired = store.isExpired({
        idToken: 'x',
        refreshToken: 'x',
        accessToken: 'x',
        expiresAt: fixedNow + 3600,
      });
      expect(expired).toBe(false);
    });
  });

  describe('Auth Required / Token Expired helpers', () => {
    it('authRequiredError returns AUTH_REQUIRED', () => {
      const err = authRequiredError();
      expect(err.code).toBe('AUTH_REQUIRED');
      expect(err.remedy).toContain('login');
    });

    it('tokenExpiredError returns AUTH_TOKEN_EXPIRED', () => {
      const err = tokenExpiredError();
      expect(err.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(err.remedy).toContain('login');
    });
  });
});
