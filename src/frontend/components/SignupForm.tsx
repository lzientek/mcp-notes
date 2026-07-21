import { useState, useRef, useEffect, type FormEvent } from 'react';
import { validateEmail, validatePassword } from '../validators/index.js';
import { FieldError } from './FieldError.js';
import { ErrorAlert } from './ErrorAlert.js';

interface SignupFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  isLoading: boolean;
  serverError: string | null;
}

export function SignupForm({ onSubmit, isLoading, serverError }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email: string | null; password: string | null }>({
    email: null,
    password: null,
  });
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    setErrors({ email: emailError, password: passwordError });

    if (emailError || passwordError) return;

    await onSubmit(email, password);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1>Créer un compte</h1>

      <ErrorAlert message={serverError} />

      <div className="field">
        <label htmlFor="email">Adresse email</label>
        <input
          ref={emailRef}
          id="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: null }));
          }}
          aria-describedby="email-error"
          aria-invalid={errors.email ? true : undefined}
          disabled={isLoading}
        />
        <FieldError message={errors.email} id="email-error" />
      </div>

      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
          }}
          aria-describedby="password-error"
          aria-invalid={errors.password ? true : undefined}
          disabled={isLoading}
        />
        <FieldError message={errors.password} id="password-error" />
      </div>

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Inscription...' : "S'inscrire"}
      </button>
    </form>
  );
}
