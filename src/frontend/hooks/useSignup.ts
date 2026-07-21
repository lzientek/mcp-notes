import { useState, useCallback } from 'react';
import * as authService from '../services/auth-service.js';
import type { UseSignupReturn } from '../types.js';

export function useSignup(onSuccess: () => void): UseSignupReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const signup = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await authService.signUp(email, password);
        onSuccess();
      } catch (err: unknown) {
        const message = mapSignupError(err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess],
  );

  return { signup, isLoading, error, clearError };
}

function mapSignupError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'UsernameExistsException') {
      return 'Un compte avec cet email existe déjà';
    }
    if (err.name === 'NetworkError' || err.message.includes('fetch')) {
      return 'Erreur de connexion. Veuillez réessayer.';
    }
  }
  return 'Une erreur est survenue. Veuillez réessayer.';
}
