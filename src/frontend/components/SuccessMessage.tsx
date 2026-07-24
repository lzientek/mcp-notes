import { useState, useEffect } from 'react';

export function SuccessMessage() {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          window.location.href = '/setup';
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div role="alert" aria-live="assertive" className="success">
      <h1>Compte activé avec succès !</h1>
      <p>Redirection dans {countdown} seconde{countdown > 1 ? 's' : ''}...</p>
      <p>
        <a href="/setup">Configurer mon assistant IA</a>
      </p>
    </div>
  );
}
