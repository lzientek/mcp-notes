import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCredentialStore } from '../../../src/mcp-server/storage/credentials.js';
import type { CognitoTokens } from '../../../src/types/auth.js';

// Use a temp directory for testing
function makeTempPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-notes-test-'));
  return path.join(tmpDir, 'credentials.json');
}

// Arbitrary for valid CognitoTokens
const cognitoTokensArb = fc.record({
  idToken: fc.string({ minLength: 1, maxLength: 200 }),
  refreshToken: fc.string({ minLength: 1, maxLength: 200 }),
  accessToken: fc.string({ minLength: 1, maxLength: 200 }),
  expiresAt: fc.nat({ max: 2000000000 }),
});

const tempPaths: string[] = [];

afterEach(() => {
  for (const p of tempPaths) {
    try {
      fs.rmSync(path.dirname(p), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempPaths.length = 0;
});

/**
 * Property 3: Credential file round-trip
 * For any valid CognitoTokens, save(tokens) then load() returns identical field values.
 *
 * **Validates: Requirements 4.1**
 */
describe('Property 3: Credential file round-trip', () => {
  it('save then load returns identical token values', async () => {
    await fc.assert(
      fc.asyncProperty(cognitoTokensArb, async (tokens: CognitoTokens) => {
        const filePath = makeTempPath();
        tempPaths.push(filePath);
        const store = createCredentialStore({ filePath });

        await store.save(tokens);
        const loaded = await store.load();

        expect(loaded).not.toBeNull();
        expect(loaded!.idToken).toBe(tokens.idToken);
        expect(loaded!.refreshToken).toBe(tokens.refreshToken);
        expect(loaded!.accessToken).toBe(tokens.accessToken);
        expect(loaded!.expiresAt).toBe(tokens.expiresAt);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 4: Credential file permissions invariant
 * For any call to save(tokens), the resulting file has Unix permissions 0600.
 *
 * **Validates: Requirements 4.2**
 */
describe('Property 4: Credential file permissions invariant', () => {
  it('saved file always has mode 0600 (owner read/write only)', async () => {
    await fc.assert(
      fc.asyncProperty(cognitoTokensArb, async (tokens: CognitoTokens) => {
        const filePath = makeTempPath();
        tempPaths.push(filePath);
        const store = createCredentialStore({ filePath });

        await store.save(tokens);

        const stats = fs.statSync(filePath);
        const mode = stats.mode & 0o777;
        expect(mode).toBe(0o600);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 8: Token expiration detection
 * For any CognitoTokens where expiresAt < now, isExpired returns true.
 * For any CognitoTokens where expiresAt > now, isExpired returns false.
 *
 * **Validates: Requirements 5.3**
 */
describe('Property 8: Token expiration detection', () => {
  it('returns true when expiresAt is in the past', () => {
    const fixedNow = 1000000;
    const store = createCredentialStore({
      filePath: '/tmp/unused',
      now: () => fixedNow,
    });

    fc.assert(
      fc.property(
        fc.nat({ max: fixedNow - 1 }),
        (expiresAt) => {
          const tokens: CognitoTokens = {
            idToken: 'x',
            refreshToken: 'x',
            accessToken: 'x',
            expiresAt,
          };
          expect(store.isExpired(tokens)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns false when expiresAt is in the future', () => {
    const fixedNow = 1000000;
    const store = createCredentialStore({
      filePath: '/tmp/unused',
      now: () => fixedNow,
    });

    fc.assert(
      fc.property(
        fc.integer({ min: fixedNow + 1, max: 2000000000 }),
        (expiresAt) => {
          const tokens: CognitoTokens = {
            idToken: 'x',
            refreshToken: 'x',
            accessToken: 'x',
            expiresAt,
          };
          expect(store.isExpired(tokens)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
