import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorAlert } from '../../../../src/frontend/components/ErrorAlert.js';

describe('ErrorAlert', () => {
  it('ne rend rien quand message est null', () => {
    const { container } = render(<ErrorAlert message={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('affiche le message avec role="alert" et aria-live="assertive"', () => {
    render(<ErrorAlert message="Erreur serveur" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Erreur serveur');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });
});
