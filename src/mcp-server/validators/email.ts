/**
 * Validates that a string conforms to standard email format.
 * Checks: exactly one @, non-empty local part, non-empty domain with at least one dot.
 */
export function validateEmail(input: string): boolean {
  if (!input || typeof input !== 'string') {
    return false;
  }

  const atIndex = input.indexOf('@');
  const lastAtIndex = input.lastIndexOf('@');

  // Must contain exactly one @
  if (atIndex === -1 || atIndex !== lastAtIndex) {
    return false;
  }

  const localPart = input.slice(0, atIndex);
  const domain = input.slice(atIndex + 1);

  // Non-empty local part
  if (localPart.length === 0) {
    return false;
  }

  // Non-empty domain with at least one dot
  if (domain.length === 0) {
    return false;
  }

  const dotIndex = domain.indexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  // Dot cannot be first or last character of domain
  if (dotIndex === 0 || dotIndex === domain.length - 1) {
    return false;
  }

  return true;
}
