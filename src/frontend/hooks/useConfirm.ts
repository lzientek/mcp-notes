import { useState, useCallback } from 'react';
import * as authService from '../services/auth-service.js';
import type { UseConfirmReturn } from '../types.js';

export function useConfirm(onSuccess: () => void): UseConfirmReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const confirm = useCallback(
    async (email: string, code: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await authService.confirmSignUp(email, code);
        onSuccess();
      } catch (err: unknown) {
        const message = mapConfirmError(err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess],
  );

  return { confirm, isLoading, error, clearError };
}

function mapConfirmError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'CodeMismatchException') {
      return 'Le code saisi est incorrect';
    }
    if (err.name === 'ExpiredCodeException') {
      return 'Le code a expiré. Demandez-en un nouveau.';
    }
    if (err.name === 'NetworkError' || err.message.includes('fetch')) {
      return 'Erreur de connexion. Veuillez réessayer.';
    }
  }
  return 'Une erreur est survenue. Veuillez réessayer.';
}
