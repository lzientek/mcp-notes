import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmForm } from '../../../../src/frontend/components/ConfirmForm.js';
import type { UseResendCodeReturn } from '../../../../src/frontend/types.js';

describe('ConfirmForm', () => {
  const mockResendCode: UseResendCodeReturn = {
    resend: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    cooldownRemaining: 0,
    message: null,
  };

  const defaultProps = {
    email: 'user@test.com',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    serverError: null,
    resendCode: mockResendCode,
  };

  it('affiche le champ code et l\'email de destination', () => {
    render(<ConfirmForm {...defaultProps} />);
    expect(screen.getByText(/user@test.com/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Code de vérification/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument();
  });

  it('affiche une erreur si le code est vide à la soumission', async () => {
    const user = userEvent.setup();
    render(<ConfirmForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(screen.getByText('Le code de vérification est requis')).toBeInTheDocument();
  });

  it('affiche une erreur si le code n\'a pas 6 chiffres', async () => {
    const user = userEvent.setup();
    render(<ConfirmForm {...defaultProps} />);

    await user.type(screen.getByLabelText(/Code de vérification/), '123');
    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(screen.getByText('Le code doit contenir exactement 6 chiffres')).toBeInTheDocument();
  });

  it('appelle onSubmit avec le code quand valide', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmForm {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Code de vérification/), '123456');
    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('affiche le cooldown sur le bouton renvoyer', () => {
    render(
      <ConfirmForm
        {...defaultProps}
        resendCode={{ ...mockResendCode, cooldownRemaining: 25 }}
      />,
    );
    expect(screen.getByText(/Renvoyer le code \(25s\)/)).toBeDisabled();
  });

  it('affiche l\'erreur serveur', () => {
    render(<ConfirmForm {...defaultProps} serverError="Le code saisi est incorrect" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Le code saisi est incorrect');
  });
});
