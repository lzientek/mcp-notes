import type { LoginError } from '../hooks/useLogin.js';

interface ErrorAlertProps {
  message: string | LoginError | null;
}

export function ErrorAlert({ message }: ErrorAlertProps) {
  if (!message) return null;

  if (typeof message === 'string') {
    return (
      <div role="alert" aria-live="assertive" className="error-alert">
        {message}
      </div>
    );
  }

  return (
    <div role="alert" aria-live="assertive" className="error-alert">
      <p className="error-alert__message">{message.message}</p>
      {message.details && (
        <p className="error-alert__details">{message.details}</p>
      )}
      {message.requestId && (
        <p className="error-alert__request-id">Request ID : {message.requestId}</p>
      )}
    </div>
  );
}
