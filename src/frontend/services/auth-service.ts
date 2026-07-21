import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CONFIG } from '../config.js';

const client = new CognitoIdentityProviderClient({ region: CONFIG.region });

export async function signUp(email: string, password: string): Promise<void> {
  await client.send(
    new SignUpCommand({
      ClientId: CONFIG.cognitoClientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    }),
  );
}

export async function confirmSignUp(
  email: string,
  code: string,
): Promise<void> {
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: CONFIG.cognitoClientId,
      Username: email,
      ConfirmationCode: code,
    }),
  );
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await client.send(
    new ResendConfirmationCodeCommand({
      ClientId: CONFIG.cognitoClientId,
      Username: email,
    }),
  );
}


export interface LoginResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const result = await client.send(
    new InitiateAuthCommand({
      ClientId: CONFIG.cognitoClientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  );

  const auth = result.AuthenticationResult;
  if (!auth?.IdToken || !auth?.AccessToken || !auth?.RefreshToken) {
    throw new Error('Authentication succeeded but tokens were not returned');
  }

  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn ?? 3600,
  };
}

export async function deliverTokensToLocalServer(
  tokens: LoginResult,
  port: number,
): Promise<void> {
  const response = await fetch(`http://localhost:${port}/auth/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
    throw new Error(body.message || `Server responded with ${response.status}`);
  }
}
