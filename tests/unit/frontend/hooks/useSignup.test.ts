import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSignup } from '../../../../src/frontend/hooks/useSignup.js';

vi.mock('../../../../src/frontend/services/auth-service.js', () => ({
  signUp: vi.fn(),
}));

import * as authService from '../../../../src/frontend/services/auth-service.js';

describe('useSignup', () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('commence avec isLoading=false et error=null', () => {
    const { result } = renderHook(() => useSignup(onSuccess));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('appelle authService.signUp et onSuccess en cas de succès', async () => {
    vi.mocked(authService.signUp).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSignup(onSuccess));

    await act(async () => {
      await result.current.signup('user@example.com', 'password123');
    });

    expect(authService.signUp).toHaveBeenCalledWith('user@example.com', 'password123');
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it('mappe UsernameExistsException en message FR', async () => {
    const error = new Error('User already exists');
    error.name = 'UsernameExistsException';
    vi.mocked(authService.signUp).mockRejectedValueOnce(error);

    const { result } = renderHook(() => useSignup(onSuccess));

    await act(async () => {
      await result.current.signup('user@example.com', 'password123');
    });

    expect(result.current.error).toBe('Un compte avec cet email existe déjà');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('mappe les erreurs inconnues en message générique', async () => {
    vi.mocked(authService.signUp).mockRejectedValueOnce(new Error('Unknown'));

    const { result } = renderHook(() => useSignup(onSuccess));

    await act(async () => {
      await result.current.signup('user@example.com', 'password123');
    });

    expect(result.current.error).toBe('Une erreur est survenue. Veuillez réessayer.');
  });

  it('clearError remet error à null', async () => {
    vi.mocked(authService.signUp).mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useSignup(onSuccess));

    await act(async () => {
      await result.current.signup('a@b.com', 'pwd12345');
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
