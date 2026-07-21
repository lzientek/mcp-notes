import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResendCode } from '../../../../src/frontend/hooks/useResendCode.js';

vi.mock('../../../../src/frontend/services/auth-service.js', () => ({
  resendConfirmationCode: vi.fn(),
}));

import * as authService from '../../../../src/frontend/services/auth-service.js';

describe('useResendCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commence avec cooldownRemaining=0', () => {
    const { result } = renderHook(() => useResendCode());
    expect(result.current.cooldownRemaining).toBe(0);
    expect(result.current.message).toBeNull();
  });

  it('appelle resendConfirmationCode et démarre un cooldown de 30s', async () => {
    vi.mocked(authService.resendConfirmationCode).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useResendCode());

    await act(async () => {
      await result.current.resend('user@example.com');
    });

    expect(authService.resendConfirmationCode).toHaveBeenCalledWith('user@example.com');
    expect(result.current.message).toBe('Code renvoyé avec succès');
    expect(result.current.cooldownRemaining).toBe(30);

    // Avance de 5 secondes
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.cooldownRemaining).toBe(25);

    // Avance au bout du cooldown
    act(() => {
      vi.advanceTimersByTime(25000);
    });
    expect(result.current.cooldownRemaining).toBe(0);
  });

  it('ne renvoie pas si le cooldown est actif', async () => {
    vi.mocked(authService.resendConfirmationCode).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useResendCode());

    await act(async () => {
      await result.current.resend('user@example.com');
    });

    // Essaie de renvoyer pendant le cooldown
    await act(async () => {
      await result.current.resend('user@example.com');
    });

    expect(authService.resendConfirmationCode).toHaveBeenCalledTimes(1);
  });
});
