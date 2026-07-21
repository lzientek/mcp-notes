import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn();
  return { mockSend };
});

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class { send = mockSend; },
  SignUpCommand: class { constructor(params: Record<string, unknown>) { Object.assign(this, params); } },
  ConfirmSignUpCommand: class { constructor(params: Record<string, unknown>) { Object.assign(this, params); } },
  ResendConfirmationCodeCommand: class { constructor(params: Record<string, unknown>) { Object.assign(this, params); } },
}));

import { signUp, confirmSignUp, resendConfirmationCode } from '../../../../src/frontend/services/auth-service.js';

describe('auth-service', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('signUp', () => {
    it('envoie un SignUpCommand avec les bons paramètres', async () => {
      mockSend.mockResolvedValueOnce({});
      await signUp('user@example.com', 'password123');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command.ClientId).toBe('28ede6qudr0af0tt3k0i7aep8g');
      expect(command.Username).toBe('user@example.com');
      expect(command.Password).toBe('password123');
      expect(command.UserAttributes).toEqual([{ Name: 'email', Value: 'user@example.com' }]);
    });

    it('propage les erreurs Cognito', async () => {
      const error = new Error('UsernameExistsException');
      error.name = 'UsernameExistsException';
      mockSend.mockRejectedValueOnce(error);

      await expect(signUp('existing@example.com', 'password123')).rejects.toThrow('UsernameExistsException');
    });
  });

  describe('confirmSignUp', () => {
    it('envoie un ConfirmSignUpCommand avec les bons paramètres', async () => {
      mockSend.mockResolvedValueOnce({});
      await confirmSignUp('user@example.com', '123456');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command.ClientId).toBe('28ede6qudr0af0tt3k0i7aep8g');
      expect(command.Username).toBe('user@example.com');
      expect(command.ConfirmationCode).toBe('123456');
    });

    it('propage les erreurs Cognito', async () => {
      const error = new Error('CodeMismatchException');
      error.name = 'CodeMismatchException';
      mockSend.mockRejectedValueOnce(error);

      await expect(confirmSignUp('user@example.com', '000000')).rejects.toThrow('CodeMismatchException');
    });
  });

  describe('resendConfirmationCode', () => {
    it('envoie un ResendConfirmationCodeCommand avec les bons paramètres', async () => {
      mockSend.mockResolvedValueOnce({});
      await resendConfirmationCode('user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command.ClientId).toBe('28ede6qudr0af0tt3k0i7aep8g');
      expect(command.Username).toBe('user@example.com');
    });
  });
});
