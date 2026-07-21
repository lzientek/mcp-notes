import { useState, useCallback } from 'react';
import { useLogin } from '../hooks/useLogin.js';
import { ErrorAlert } from './ErrorAlert.js';
import { FieldError } from './FieldError.js';
import { validateEmail } from '../validators/index.js';

interface LoginFormProps {
  callbackPort: number;
  onSuccess: () => void;
}

export function LoginForm({ callbackPort, onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email: string | null; password: string | null }>({
    email: null,
    password: null,
  });

  const loginHook = useLogin(onSuccess);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const emailError = validateEmail(email);
      const passwordError = !password ? 'Mot de passe requis' : null;

      setFieldErrors({ email: emailError, password: passwordError });

      if (emailError || passwordError) {
        return;
      }

      await loginHook.login(email, password, callbackPort);
    },
    [email, password, callbackPort, loginHook],
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1>Connexion MCP Notes</h1>
      <p className="mcp-context">
        Cette connexion authentifiera votre serveur MCP local (Claude Desktop).
      </p>

      <ErrorAlert message={loginHook.error} />

      <div className="field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: null }));
          }}
          autoComplete="email"
          aria-describedby="login-email-error"
          aria-invalid={fieldErrors.email ? true : undefined}
          disabled={loginHook.isLoading}
        />
        <FieldError message={fieldErrors.email} id="login-email-error" />
      </div>

      <div className="field">
        <label htmlFor="login-password">Mot de passe</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: null }));
          }}
          autoComplete="current-password"
          aria-describedby="login-password-error"
          aria-invalid={fieldErrors.password ? true : undefined}
          disabled={loginHook.isLoading}
        />
        <FieldError message={fieldErrors.password} id="login-password-error" />
      </div>

      <button type="submit" disabled={loginHook.isLoading}>
        {loginHook.isLoading ? 'Connexion en cours...' : 'Se connecter'}
      </button>
    </form>
  );
}
