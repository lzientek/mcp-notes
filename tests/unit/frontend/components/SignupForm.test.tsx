import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupForm } from '../../../../src/frontend/components/SignupForm.js';

describe('SignupForm', () => {
  const defaultProps = {
    onSubmit: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    serverError: null,
  };

  it('affiche les champs email et mot de passe avec labels', () => {
    render(<SignupForm {...defaultProps} />);
    expect(screen.getByLabelText('Adresse email')).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "S'inscrire" })).toBeInTheDocument();
  });

  it('affiche les erreurs de validation à la soumission avec champs vides', async () => {
    const user = userEvent.setup();
    render(<SignupForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: "S'inscrire" }));

    expect(screen.getByText("L'adresse email est requise")).toBeInTheDocument();
    expect(screen.getByText('Le mot de passe est requis')).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it('affiche une erreur pour un email invalide', async () => {
    const user = userEvent.setup();
    render(<SignupForm {...defaultProps} />);

    await user.type(screen.getByLabelText('Adresse email'), 'invalid');
    await user.type(screen.getByLabelText('Mot de passe'), 'password123');
    await user.click(screen.getByRole('button', { name: "S'inscrire" }));

    expect(screen.getByText("Le format de l'adresse email est invalide")).toBeInTheDocument();
  });

  it('affiche une erreur pour un mot de passe trop court', async () => {
    const user = userEvent.setup();
    render(<SignupForm {...defaultProps} />);

    await user.type(screen.getByLabelText('Adresse email'), 'user@test.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'short');
    await user.click(screen.getByRole('button', { name: "S'inscrire" }));

    expect(screen.getByText('Le mot de passe doit contenir au minimum 8 caractères')).toBeInTheDocument();
  });

  it('appelle onSubmit avec les bonnes valeurs quand le formulaire est valide', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SignupForm {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Adresse email'), 'user@test.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'password123');
    await user.click(screen.getByRole('button', { name: "S'inscrire" }));

    expect(onSubmit).toHaveBeenCalledWith('user@test.com', 'password123');
  });

  it('désactive le bouton et affiche "Inscription..." quand isLoading=true', () => {
    render(<SignupForm {...defaultProps} isLoading={true} />);
    const button = screen.getByRole('button', { name: 'Inscription...' });
    expect(button).toBeDisabled();
  });

  it('affiche l\'erreur serveur via ErrorAlert', () => {
    render(<SignupForm {...defaultProps} serverError="Un compte avec cet email existe déjà" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Un compte avec cet email existe déjà');
  });

  it('marque les champs invalides avec aria-invalid', async () => {
    const user = userEvent.setup();
    render(<SignupForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: "S'inscrire" }));

    expect(screen.getByLabelText('Adresse email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('aria-invalid', 'true');
  });
});
