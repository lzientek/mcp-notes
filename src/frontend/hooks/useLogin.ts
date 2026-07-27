import { useState, useCallback } from 'react';
import * as authService from '../services/auth-service.js';
import { saveTokens } from '../services/api-client.js';

export interface LoginError {
  message: string;
  details?: string;
  requestId?: string;
}

export interface UseLoginReturn {
  login: (email: string, password: string, port: number) => Promise<void>;
  isLoading: boolean;
  error: LoginError | null;
  clearError: () => void;
}

export function useLogin(onSuccess: () => void): UseLoginReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(
    async (email: string, password: string, port: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const tokens = await authService.login(email, password);
        if (port > 0) {
          await authService.deliverTokensToLocalServer(tokens, port);
        } else {
          saveTokens(tokens.idToken, tokens.refreshToken);
        }
        onSuccess();
      } catch (err: unknown) {
        const loginError = mapLoginError(err);
        setError(loginError);
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess],
  );

  return { login, isLoading, error, clearError };
}

function extractRequestId(err: unknown): string | undefined {
  if (
    err &&
    typeof err === 'object' &&
    '$metadata' in err &&
    typeof (err as Record<string, unknown>).$metadata === 'object'
  ) {
    const metadata = (err as Record<string, unknown>).$metadata as Record<string, unknown>;
    return metadata.requestId as string | undefined;
  }
  return undefined;
}

function mapLoginError(err: unknown): LoginError {
  const requestId = extractRequestId(err);

  if (err instanceof Error) {
    if (err.name === 'NotAuthorizedException') {
      return {
        message: 'Email ou mot de passe incorrect.',
        requestId,
      };
    }
    if (err.name === 'UserNotConfirmedException') {
      return {
        message: 'Compte non confirmé. Veuillez d\'abord confirmer votre email.',
        requestId,
      };
    }
    if (err.name === 'UserNotFoundException') {
      return {
        message: 'Aucun compte trouvé avec cet email.',
        requestId,
      };
    }
    if (err.message.includes('fetch') || err.message.includes('Failed')) {
      return {
        message: 'Le serveur MCP local n\'est pas joignable. Assurez-vous que votre client MCP est ouvert et que vous avez lancé le web login.',
        details: err.message,
      };
    }
    if (err.message.includes('Server responded')) {
      return {
        message: err.message,
        requestId,
      };
    }

    return {
      message: 'Une erreur est survenue. Veuillez réessayer.',
      details: `${err.name}: ${err.message}`,
      requestId,
    };
  }

  return {
    message: 'Une erreur inattendue est survenue. Veuillez réessayer.',
    details: String(err),
  };
}
