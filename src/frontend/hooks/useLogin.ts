import { useState, useCallback } from 'react';
import * as authService from '../services/auth-service.js';

export interface UseLoginReturn {
  login: (email: string, password: string, port: number) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useLogin(onSuccess: () => void): UseLoginReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(
    async (email: string, password: string, port: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const tokens = await authService.login(email, password);
        if (port > 0) {
          await authService.deliverTokensToLocalServer(tokens, port);
        }
        onSuccess();
      } catch (err: unknown) {
        const message = mapLoginError(err);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess],
  );

  return { login, isLoading, error, clearError };
}

function mapLoginError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'NotAuthorizedException') {
      return 'Email ou mot de passe incorrect.';
    }
    if (err.name === 'UserNotConfirmedException') {
      return 'Compte non confirmé. Veuillez d\'abord confirmer votre email.';
    }
    if (err.name === 'UserNotFoundException') {
      return 'Aucun compte trouvé avec cet email.';
    }
    if (err.message.includes('fetch') || err.message.includes('Failed')) {
      return 'Le serveur MCP local n\'est pas joignable. Assurez-vous que Claude Desktop est ouvert et que vous avez lancé le web login.';
    }
    if (err.message.includes('Server responded')) {
      return err.message;
    }
  }
  return 'Une erreur est survenue. Veuillez réessayer.';
}
