interface ErrorAlertProps {
  message: string | null;
}

export function ErrorAlert({ message }: ErrorAlertProps) {
  if (!message) return null;
  return (
    <div role="alert" aria-live="assertive" className="error-alert">
      {message}
    </div>
  );
}
