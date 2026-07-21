interface FieldErrorProps {
  message: string | null;
  id: string;
}

export function FieldError({ message, id }: FieldErrorProps) {
  if (!message) return null;
  return (
    <span id={id} className="field-error" role="alert">
      {message}
    </span>
  );
}
