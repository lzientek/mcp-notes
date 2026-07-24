import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignupForm } from '../components/SignupForm.js';
import { ConfirmForm } from '../components/ConfirmForm.js';
import { SuccessMessage } from '../components/SuccessMessage.js';
import { useSignup } from '../hooks/useSignup.js';
import { useConfirm } from '../hooks/useConfirm.js';
import { useResendCode } from '../hooks/useResendCode.js';

type SignupStep = 'signup' | 'confirm' | 'success';

function useScrollAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

export function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignupStep>('signup');
  const [email, setEmail] = useState('');

  const feat1 = useScrollAnimation();
  const feat2 = useScrollAnimation();
  const feat3 = useScrollAnimation();
  const feat4 = useScrollAnimation();

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
    <div className="landing">
      {/* ─── Hero Section ─────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <div className="landing-hero-content">
          <div className="landing-hero-text">
            <img src="/static/notlai_logo_white_transparent.png" alt="Notlai" className="landing-logo" />
            <h1>Vos notes, propulsées par l'IA</h1>
            <p className="landing-subtitle">
              Prenez des notes directement depuis vos conversations avec Claude, ChatGPT ou tout assistant IA compatible MCP. Retrouvez-les ici, organisées et toujours accessibles.
            </p>
            <div className="landing-badges">
              <span className="landing-badge">Markdown</span>
              <span className="landing-badge">Tags automatiques</span>
              <span className="landing-badge">Open Source</span>
            </div>
          </div>
          <div className="landing-hero-form">
            {step === 'signup' && (
              <>
                <SignupForm
                  onSubmit={handleSignup}
                  isLoading={signupHook.isLoading}
                  serverError={signupHook.error}
                />
                <p className="auth-switch">
                  Déjà un compte ?{' '}
                  <button type="button" className="link-btn" onClick={() => navigate('/login')}>
                    Se connecter
                  </button>
                </p>
              </>
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
          </div>
        </div>
      </section>

      {/* ─── Features Section ─────────────────────────────────── */}
      <section className="landing-features">
        <h2 className="landing-section-title">Comment ça marche</h2>
        <div className="landing-features-grid">
          <div ref={feat1.ref} className={`landing-feature ${feat1.isVisible ? 'visible' : ''}`}>
            <div className="landing-feature-img">
              <img
                src="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop"
                alt="Intelligence artificielle"
                loading="lazy"
              />
            </div>
            <h3>1. Parlez à votre IA</h3>
            <p>Demandez à Claude, ChatGPT ou tout assistant compatible MCP de prendre une note. Il comprend le contexte et structure pour vous.</p>
          </div>

          <div ref={feat2.ref} className={`landing-feature ${feat2.isVisible ? 'visible' : ''}`}>
            <div className="landing-feature-img">
              <img
                src="https://images.unsplash.com/photo-1512758017271-d7b84c2113f1?w=600&h=400&fit=crop"
                alt="Notes organisées"
                loading="lazy"
              />
            </div>
            <h3>2. Notes auto-organisées</h3>
            <p>L'IA assigne automatiquement des tags pertinents. Vos notes sont classées sans effort — retrouvez tout en un instant.</p>
          </div>

          <div ref={feat3.ref} className={`landing-feature ${feat3.isVisible ? 'visible' : ''}`}>
            <div className="landing-feature-img">
              <img
                src="https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&h=400&fit=crop"
                alt="Consultation depuis n'importe où"
                loading="lazy"
              />
            </div>
            <h3>3. Consultez partout</h3>
            <p>Retrouvez vos notes depuis n'importe quel navigateur. Recherche, filtres par tags et par date — tout est là.</p>
          </div>

          <div ref={feat4.ref} className={`landing-feature ${feat4.isVisible ? 'visible' : ''}`}>
            <div className="landing-feature-img">
              <img
                src="https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=600&h=400&fit=crop"
                alt="Markdown et code"
                loading="lazy"
              />
            </div>
            <h3>4. Markdown natif</h3>
            <p>Titres, listes, blocs de code, tableaux — vos notes supportent le format Markdown complet, rendu avec style.</p>
          </div>
        </div>
      </section>

      {/* ─── CTA Section ──────────────────────────────────────── */}
      <section className="landing-cta">
        <h2>Prêt à essayer ?</h2>
        <p>Gratuit, open source, et vos données restent les vôtres.</p>
        <a href="#top" className="landing-cta-btn" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          Créer un compte
        </a>
      </section>

      {/* ─── Footer ───────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer-content">
          <img src="/static/notlai_logo_only.png" alt="Notlai" className="landing-footer-logo" />
          <div className="landing-footer-links">
            <a href="/setup">Installation</a>
            <a href="https://github.com/lzientek/notlai-mcp" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://www.npmjs.com/package/notlai-mcp" target="_blank" rel="noopener noreferrer">npm</a>
          </div>
          <p className="landing-footer-copy">MIT License — Built with AI, for AI workflows.</p>
        </div>
      </footer>
    </div>
  );
}
