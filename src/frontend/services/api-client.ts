const API_BASE = 'https://api.notlai.com';
const TOKEN_KEY = 'notlai_id_token';
const REFRESH_TOKEN_KEY = 'notlai_refresh_token';

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
  window.location.href = '/?action=login';
}

export function isAuthenticated(): boolean {
  return !!getIdToken();
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

export async function apiGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = getIdToken();
  if (!token) {
    redirectToLogin();
    throw new ApiError('No token', 401);
  }

  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    clearSession();
    redirectToLogin();
    throw new ApiError('Unauthorized', 401);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(body || `API error: ${res.status}`, res.status);
  }

  return res.json();
}
