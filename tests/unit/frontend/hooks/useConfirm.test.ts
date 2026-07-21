import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirm } from '../../../../src/frontend/hooks/useConfirm.js';

vi.mock('../../../../src/frontend/services/auth-service.js', () => ({
  confirmSignUp: vi.fn(),
}));

import * as authService from '../../../../src/frontend/services/auth-service.js';

describe('useConfirm', () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('appelle authService.confirmSignUp et onSuccess en cas de succès', async () => {
    vi.mocked(authService.confirmSignUp).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useConfirm(onSuccess));

    await act(async () => {
      await result.current.confirm('user@example.com', '123456');
    });

    expect(authService.confirmSignUp).toHaveBeenCalledWith('user@example.com', '123456');
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('mappe CodeMismatchException en message FR', async () => {
    const error = new Error('Code mismatch');
    error.name = 'CodeMismatchException';
    vi.mocked(authService.confirmSignUp).mockRejectedValueOnce(error);

    const { result } = renderHook(() => useConfirm(onSuccess));

    await act(async () => {
      await result.current.confirm('user@example.com', '000000');
    });

    expect(result.current.error).toBe('Le code saisi est incorrect');
  });

  it('mappe ExpiredCodeException en message FR', async () => {
    const error = new Error('Expired');
    error.name = 'ExpiredCodeException';
    vi.mocked(authService.confirmSignUp).mockRejectedValueOnce(error);

    const { result } = renderHook(() => useConfirm(onSuccess));

    await act(async () => {
      await result.current.confirm('user@example.com', '111111');
    });

    expect(result.current.error).toBe('Le code a expiré. Demandez-en un nouveau.');
  });
});
