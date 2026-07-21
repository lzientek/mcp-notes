import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessMessage } from '../../../../src/frontend/components/SuccessMessage.js';

describe('SuccessMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('affiche le message de succès', () => {
    render(<SuccessMessage />);
    expect(screen.getByText('Compte activé avec succès !')).toBeInTheDocument();
  });

  it('affiche le compteur de redirection', () => {
    render(<SuccessMessage />);
    expect(screen.getByText(/Redirection dans 3 secondes/)).toBeInTheDocument();
  });

  it('affiche un lien de redirection immédiate', () => {
    render(<SuccessMessage />);
    const link = screen.getByRole('link', { name: /connexion/i });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('a role="alert" pour les lecteurs d\'écran', () => {
    render(<SuccessMessage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
