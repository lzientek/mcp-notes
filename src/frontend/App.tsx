import { useState, useCallback, useMemo } from 'react';
import { SignupForm } from './components/SignupForm.js';
import { ConfirmForm } from './components/ConfirmForm.js';
import { SuccessMessage } from './components/SuccessMessage.js';
import { LoginForm } from './components/LoginForm.js';
import { Dashboard } from './components/Dashboard.js';
import { NoteDetail } from './components/NoteDetail.js';
import { useSignup } from './hooks/useSignup.js';
import { useConfirm } from './hooks/useConfirm.js';
import { useResendCode } from './hooks/useResendCode.js';
import { isAuthenticated } from './services/api-client.js';
import type { AppStep } from './types.js';

function parseUrlParams(): { initialStep: AppStep; port: number } {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const portStr = params.get('port');

  if (action === 'login' && portStr) {
    const port = Number(portStr);
    if (Number.isFinite(port) && port > 0) {
      return { initialStep: 'login', port };
    }
  }

  // If already authenticated and no specific action, go to dashboard
  if (!action && isAuthenticated()) {
    return { initialStep: 'dashboard', port: 0 };
  }

  return { initialStep: 'signup', port: 0 };
}

export function App() {
  const { initialStep, port: initialPort } = useMemo(() => parseUrlParams(), []);

  const [step, setStep] = useState<AppStep>(initialStep);
  const [email, setEmail] = useState('');
  const [callbackPort] = useState(initialPort);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const signupHook = useSignup(
    useCallback(() => setStep('confirm'), []),
  );

  const confirmHook = useConfirm(
    useCallback(() => setStep('success'), []),
  );

  const resendCodeHook = useResendCode();

  const handleSignup = async (emailValue: string, password: string) => {
    setEmail(emailValue);
    await signupHook.signup(emailValue, password);
  };

  const handleConfirm = async (code: string) => {
    await confirmHook.confirm(email, code);
  };

  const handleLoginSuccess = useCallback(() => {
    setStep('dashboard');
  }, []);

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
    setStep('detail');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setSelectedNoteId(null);
    setStep('dashboard');
  }, []);

  return (
    <div className="app-wrapper">
      {(step === 'signup' || step === 'confirm' || step === 'success' || step === 'login' || step === 'login-success' || step === 'login-error') && (
        <div className="app-logo">
          <img src="./static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
        </div>
      )}

      {step === 'signup' && (
        <SignupForm
          onSubmit={handleSignup}
          isLoading={signupHook.isLoading}
          serverError={signupHook.error}
        />
      )}
      {step === 'confirm' && (
        <ConfirmForm
          email={email}
          onSubmit={handleConfirm}
          isLoading={confirmHook.isLoading}
          serverError={confirmHook.error}
          resendCode={resendCodeHook}
        />
      )}
      {step === 'success' && <SuccessMessage />}
      {step === 'login' && (
        <LoginForm callbackPort={callbackPort} onSuccess={handleLoginSuccess} />
      )}
      {step === 'login-success' && (
        <div className="success">
          <h1>✓ Authentification réussie</h1>
          <p>
            Vous pouvez retourner dans Claude Desktop pour utiliser vos notes.
          </p>
        </div>
      )}
      {step === 'dashboard' && (
        <Dashboard onSelectNote={handleSelectNote} />
      )}
      {step === 'detail' && selectedNoteId && (
        <NoteDetail noteId={selectedNoteId} onBack={handleBackToDashboard} />
      )}
    </div>
  );
}
