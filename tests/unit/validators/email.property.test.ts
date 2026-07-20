import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateEmail } from '../../../src/mcp-server/validators/email.js';

/**
 * Property 1: Email validation correctness
 * For any string, validateEmail accepts it iff it conforms to local-part@domain
 * (one @, non-empty local part, non-empty domain with at least one dot).
 *
 * **Validates: Requirements 1.4**
 */
describe('Property 1: Email validation correctness', () => {
  it('accepts any well-formed email (local@domain.tld pattern)', () => {
    // Generate valid email-like strings: non-empty local + @ + non-empty domain with dot
    const validEmail = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !s.includes('@') && !s.includes(' ')),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@') && !s.includes('.') && !s.includes(' ') && s.length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !s.includes('@') && !s.includes('.') && !s.includes(' ') && s.length > 0),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    fc.assert(
      fc.property(validEmail, (email) => {
        expect(validateEmail(email)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any string without an @ sign', () => {
    const noAt = fc.string({ minLength: 0, maxLength: 100 }).filter((s) => !s.includes('@'));

    fc.assert(
      fc.property(noAt, (input) => {
        expect(validateEmail(input)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects any string with multiple @ signs', () => {
    const multiAt = fc
      .tuple(fc.string(), fc.string(), fc.string())
      .map(([a, b, c]) => `${a}@${b}@${c}`);

    fc.assert(
      fc.property(multiAt, (input) => {
        expect(validateEmail(input)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects when local part is empty', () => {
    const emptyLocal = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@') && !s.includes('.')),
        fc.string({ minLength: 1, maxLength: 5 }).filter((s) => !s.includes('@') && !s.includes('.')),
      )
      .map(([domain, tld]) => `@${domain}.${tld}`);

    fc.assert(
      fc.property(emptyLocal, (input) => {
        expect(validateEmail(input)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects when domain has no dot', () => {
    const noDot = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@')),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('@') && !s.includes('.')),
      )
      .map(([local, domain]) => `${local}@${domain}`);

    fc.assert(
      fc.property(noDot, (input) => {
        expect(validateEmail(input)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
