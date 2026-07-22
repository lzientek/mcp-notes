import { useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm.js';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const port = Number(searchParams.get('port')) || 0;

  const handleSuccess = useCallback(() => {
    if (port > 0) {
      // MCP login flow — just show success message, don't navigate to dashboard
      return;
    }
    navigate('/');
  }, [port, navigate]);

  return (
    <div className="app-wrapper">
      <div className="app-logo">
        <img src="./static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
      </div>
      <LoginForm callbackPort={port} onSuccess={handleSuccess} />
      {!port && (
        <p className="auth-switch">
          Pas encore de compte ?{' '}
          <button type="button" className="link-btn" onClick={() => navigate('/signup')}>
            Créer un compte
          </button>
        </p>
      )}
    </div>
  );
}
