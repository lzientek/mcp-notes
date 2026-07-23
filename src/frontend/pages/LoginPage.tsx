import { useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { LoginForm } from '../components/LoginForm.js';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mcpSuccess, setMcpSuccess] = useState(false);

  const port = Number(searchParams.get('port')) || 0;
  const isMcpFlow = port > 0;

  const handleSuccess = useCallback(() => {
    if (isMcpFlow) {
      setMcpSuccess(true);
      return;
    }
    navigate('/');
  }, [isMcpFlow, navigate]);

  if (mcpSuccess) {
    return (
      <div className="app-wrapper">
        <div className="app-logo">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
        </div>
        <div className="success">
          <h1>Connexion réussie</h1>
          <p>Vous pouvez retourner dans Claude Desktop pour utiliser vos notes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <div className="app-logo">
        <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
      </div>
      <LoginForm callbackPort={port} onSuccess={handleSuccess} />
      {!isMcpFlow && (
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
