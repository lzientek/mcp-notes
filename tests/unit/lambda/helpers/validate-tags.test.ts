import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateTags } from '../../../../src/lambda/helpers/validate-tags.js';

const mockSend = vi.fn();
const mockClient = { send: mockSend } as any;

describe('validateTags', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns valid for empty tags array', async () => {
    const result = await validateTags(mockClient, 'TagsTable', 'user1', []);
    expect(result).toEqual({ valid: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns valid when all tags exist', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ name: 'work' }, { name: 'personal' }],
    });

    const result = await validateTags(mockClient, 'TagsTable', 'user1', ['work', 'personal']);
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid with list of missing tags', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ name: 'work' }],
    });

    const result = await validateTags(mockClient, 'TagsTable', 'user1', ['work', 'nonexistent']);
    expect(result).toEqual({ valid: false, invalidTags: ['nonexistent'] });
  });

  it('is case-insensitive on tag names', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ name: 'work' }],
    });

    const result = await validateTags(mockClient, 'TagsTable', 'user1', ['Work']);
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid when no items in DB', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await validateTags(mockClient, 'TagsTable', 'user1', ['anything']);
    expect(result).toEqual({ valid: false, invalidTags: ['anything'] });
  });
});
