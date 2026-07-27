import { describe, it, expect } from 'vitest';
import { generateShareId } from '../../../../src/lambda/helpers/share-id.js';

describe('generateShareId', () => {
  it('generates a string of 22 characters', () => {
    const id = generateShareId();
    expect(id.length).toBe(22);
  });

  it('generates URL-safe characters only', () => {
    const id = generateShareId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShareId()));
    expect(ids.size).toBe(100);
  });

  it('decodes to at least 16 bytes (128 bits entropy)', () => {
    const id = generateShareId();
    // base64url: 22 chars * 6 bits = 132 bits >= 128
    const bytes = Buffer.from(id, 'base64url');
    expect(bytes.length).toBeGreaterThanOrEqual(16);
  });
});
