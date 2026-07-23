import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignupForm } from '../components/SignupForm.js';
import { ConfirmForm } from '../components/ConfirmForm.js';
import { SuccessMessage } from '../components/SuccessMessage.js';
import { useSignup } from '../hooks/useSignup.js';
import { useConfirm } from '../hooks/useConfirm.js';
import { useResendCode } from '../hooks/useResendCode.js';

type SignupStep = 'signup' | 'confirm' | 'success';

export function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignupStep>('signup');
  const [email, setEmail] = useState('');

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

  return (
    <div className="app-wrapper">
      <div className="app-logo">
        <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
      </div>

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

      {step === 'signup' && (
        <p className="auth-switch">
          Déjà un compte ?{' '}
          <button type="button" className="link-btn" onClick={() => navigate('/login')}>
            Se connecter
          </button>
        </p>
      )}
    </div>
  );
}
