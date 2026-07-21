const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'L\'adresse email est requise';
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Le format de l\'adresse email est invalide';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) {
    return 'Le mot de passe est requis';
  }
  if (value.length < 8) {
    return 'Le mot de passe doit contenir au minimum 8 caractères';
  }
  return null;
}

export function validateCode(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Le code de vérification est requis';
  }
  if (!CODE_REGEX.test(trimmed)) {
    return 'Le code doit contenir exactement 6 chiffres';
  }
  return null;
}
