import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CONFIG } from '../config.js';

const API_BASE = 'https://api.notlai.com';
const TOKEN_KEY = 'notlai_id_token';
const REFRESH_TOKEN_KEY = 'notlai_refresh_token';

const cognitoClient = new CognitoIdentityProviderClient({ region: CONFIG.region });

export function getIdToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveTokens(idToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, idToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function redirectToLogin(): void {
  window.location.href = '/login';
}

export function isAuthenticated(): boolean {
  return !!getIdToken() || !!getRefreshToken();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Token Refresh ─────────────────────────────────────────────────
let refreshPromise: Promise<string | null> | null = null;

async function refreshSession(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        ClientId: CONFIG.cognitoClientId,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      }),
    );

    const auth = result.AuthenticationResult;
    if (!auth?.IdToken) return null;

    // Refresh token is not returned on refresh — keep the existing one
    saveTokens(auth.IdToken, refreshToken);
    return auth.IdToken;
  } catch {
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const token = getIdToken();
  if (token) return token;

  // No ID token but we have a refresh token — try to refresh
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// ─── API Methods ───────────────────────────────────────────────────

/**
 * RequestInit.headers is a HeadersInit: it can be a Headers instance or an array
 * of pairs, and spreading either into an object literal silently produces
 * garbage. Headers handles all three shapes.
 */
function authHeaders(options: RequestInit, token: string): Headers {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  let token = await getValidToken();
  if (!token) {
    clearSession();
    redirectToLogin();
    throw new ApiError('No token', 401);
  }

  const res = await fetch(url, {
    ...options,
    headers: authHeaders(options, token),
  });

  if (res.status === 401) {
    // Token might have just expired — attempt refresh once
    if (!refreshPromise) {
      refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
    }
    token = await refreshPromise;

    if (token) {
      // Retry with new token
      const retry = await fetch(url, {
        ...options,
        headers: authHeaders(options, token),
      });
      if (!retry.ok && retry.status === 401) {
        clearSession();
        redirectToLogin();
        throw new ApiError('Unauthorized', 401);
      }
      return retry;
    }

    clearSession();
    redirectToLogin();
    throw new ApiError('Unauthorized', 401);
  }

  return res;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const res = await fetchWithAuth(url.toString());

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(body || `API error: ${res.status}`, res.status);
  }

  return res.json();
}

export async function apiPut<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, API_BASE);

  const res = await fetchWithAuth(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `API error: ${res.status}`, res.status);
  }

  return res.json();
}

export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, API_BASE);

  const res = await fetchWithAuth(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `API error: ${res.status}`, res.status);
  }

  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const url = new URL(path, API_BASE);

  const res = await fetchWithAuth(url.toString(), {
    method: 'DELETE',
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new ApiError(text || `API error: ${res.status}`, res.status);
  }
}
