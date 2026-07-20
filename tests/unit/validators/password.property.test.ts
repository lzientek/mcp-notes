import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from '../../../src/mcp-server/validators/password.js';

/**
 * Property 2: Password length validation
 * For any string < 8 chars, validatePassword returns { valid: false } with VALIDATION_ERROR code.
 * For any string >= 8 chars, validatePassword returns { valid: true }.
 *
 * **Validates: Requirements 2.2, 2.3**
 */
describe('Property 2: Password length validation', () => {
  it('rejects any string shorter than 8 characters with VALIDATION_ERROR', () => {
    const shortPassword = fc.string({ minLength: 0, maxLength: 7 });

    fc.assert(
      fc.property(shortPassword, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('VALIDATION_ERROR');
        expect(result.error!.message).toBeTruthy();
        expect(result.error!.remedy).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  it('accepts any string of 8 or more characters', () => {
    const longPassword = fc.string({ minLength: 8, maxLength: 128 });

    fc.assert(
      fc.property(longPassword, (password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
