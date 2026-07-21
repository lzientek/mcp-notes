import { useState, useRef, useEffect, type FormEvent } from 'react';
import { validateCode } from '../validators/index.js';
import { FieldError } from './FieldError.js';
import { ErrorAlert } from './ErrorAlert.js';
import type { UseResendCodeReturn } from '../types.js';

interface ConfirmFormProps {
  email: string;
  onSubmit: (code: string) => Promise<void>;
  isLoading: boolean;
  serverError: string | null;
  resendCode: UseResendCodeReturn;
}

export function ConfirmForm({
  email,
  onSubmit,
  isLoading,
  serverError,
  resendCode,
}: ConfirmFormProps) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const error = validateCode(code);
    setCodeError(error);

    if (error) return;

    await onSubmit(code);
  };

  const handleResend = () => {
    resendCode.resend(email);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1>Vérification de l'email</h1>
      <p className="info">Un code a été envoyé à <strong>{email}</strong></p>

      <ErrorAlert message={serverError} />

      {resendCode.message && (
        <div role="alert" aria-live="polite" className="resend-message">
          {resendCode.message}
        </div>
      )}

      <div className="field">
        <label htmlFor="code">Code de vérification (6 chiffres)</label>
        <input
          ref={codeRef}
          id="code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (codeError) setCodeError(null);
          }}
          aria-describedby="code-error"
          aria-invalid={codeError ? true : undefined}
          disabled={isLoading}
        />
        <FieldError message={codeError} id="code-error" />
      </div>

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Vérification...' : 'Valider'}
      </button>

      <p className="resend">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendCode.cooldownRemaining > 0 || resendCode.isLoading}
          className="link-button"
        >
          {resendCode.cooldownRemaining > 0
            ? `Renvoyer le code (${resendCode.cooldownRemaining}s)`
            : 'Renvoyer le code'}
        </button>
      </p>
    </form>
  );
}
