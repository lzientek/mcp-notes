import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword, validateCode } from '../../../../src/frontend/validators/index.js';

describe('validateEmail', () => {
  it('retourne une erreur si le champ est vide', () => {
    expect(validateEmail('')).toBe("L'adresse email est requise");
    expect(validateEmail('   ')).toBe("L'adresse email est requise");
  });

  it('retourne une erreur si le format est invalide', () => {
    expect(validateEmail('invalid')).toBe("Le format de l'adresse email est invalide");
    expect(validateEmail('no-at-sign.com')).toBe("Le format de l'adresse email est invalide");
    expect(validateEmail('@no-local.com')).toBe("Le format de l'adresse email est invalide");
    expect(validateEmail('user@')).toBe("Le format de l'adresse email est invalide");
  });

  it('retourne null pour un email valide', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('first.last@domain.co')).toBeNull();
    expect(validateEmail('test+tag@sub.domain.org')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('retourne une erreur si le champ est vide', () => {
    expect(validatePassword('')).toBe('Le mot de passe est requis');
  });

  it('retourne une erreur si moins de 8 caractères', () => {
    expect(validatePassword('1234567')).toBe('Le mot de passe doit contenir au minimum 8 caractères');
    expect(validatePassword('abc')).toBe('Le mot de passe doit contenir au minimum 8 caractères');
  });

  it('retourne null pour un mot de passe valide', () => {
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('monSuperMotDePasse!')).toBeNull();
  });
});

describe('validateCode', () => {
  it('retourne une erreur si le champ est vide', () => {
    expect(validateCode('')).toBe('Le code de vérification est requis');
    expect(validateCode('   ')).toBe('Le code de vérification est requis');
  });

  it('retourne une erreur si le code ne contient pas exactement 6 chiffres', () => {
    expect(validateCode('12345')).toBe('Le code doit contenir exactement 6 chiffres');
    expect(validateCode('1234567')).toBe('Le code doit contenir exactement 6 chiffres');
    expect(validateCode('abcdef')).toBe('Le code doit contenir exactement 6 chiffres');
    expect(validateCode('12ab56')).toBe('Le code doit contenir exactement 6 chiffres');
  });

  it('retourne null pour un code valide de 6 chiffres', () => {
    expect(validateCode('123456')).toBeNull();
    expect(validateCode('000000')).toBeNull();
    expect(validateCode('999999')).toBeNull();
  });
});
