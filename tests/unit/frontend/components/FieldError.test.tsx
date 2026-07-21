import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldError } from '../../../../src/frontend/components/FieldError.js';

describe('FieldError', () => {
  it('ne rend rien quand message est null', () => {
    const { container } = render(<FieldError message={null} id="test-error" />);
    expect(container.innerHTML).toBe('');
  });

  it('affiche le message avec le bon id', () => {
    render(<FieldError message="Erreur test" id="test-error" />);
    const span = screen.getByText('Erreur test');
    expect(span.id).toBe('test-error');
    expect(span.getAttribute('role')).toBe('alert');
  });
});
