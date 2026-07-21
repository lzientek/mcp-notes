import { useState, useCallback, useRef, useEffect } from 'react';
import * as authService from '../services/auth-service.js';
import type { UseResendCodeReturn } from '../types.js';

export function useResendCode(): UseResendCodeReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback(() => {
    setCooldownRemaining(30);
    intervalRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setMessage(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const resend = useCallback(
    async (email: string) => {
      if (cooldownRemaining > 0) return;
      setIsLoading(true);
      setMessage(null);
      try {
        await authService.resendConfirmationCode(email);
        setMessage('Code renvoyé avec succès');
        startCooldown();
      } catch (err: unknown) {
        if (err instanceof Error && (err.name === 'NetworkError' || err.message.includes('fetch'))) {
          setMessage('Erreur de connexion. Veuillez réessayer.');
        } else {
          setMessage('Une erreur est survenue. Veuillez réessayer.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [cooldownRemaining, startCooldown],
  );

  return { resend, isLoading, cooldownRemaining, message };
}
