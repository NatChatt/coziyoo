import * as SecureStore from 'expo-secure-store';
import { readJsonSafe } from './http';

const STORAGE_KEY = 'coziyoo_auth';
const AUTH_REFRESH_TIMEOUT_MS = 8000;

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userType: string;
  email: string;
};

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(session));
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export async function refreshAuthSession(
  apiUrl: string,
  session: AuthSession,
): Promise<AuthSession | null> {
  const recoverFromPersistedSession = async (): Promise<AuthSession | null> => {
    const persisted = await loadAuthSession();
    if (!persisted) return null;
    if (persisted.userId !== session.userId) return null;
    if (!persisted.accessToken || !persisted.refreshToken) return null;
    if (
      persisted.accessToken === session.accessToken &&
      persisted.refreshToken === session.refreshToken
    ) {
      return null;
    }
    return persisted;
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_REFRESH_TIMEOUT_MS);
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        signal: controller.signal,
      })
      .finally(() => clearTimeout(timeoutId));
    if (!response.ok) {
      // Refresh tokens rotate on every successful refresh. If another in-flight request
      // already refreshed and persisted a new session, recover from storage instead of failing.
      return await recoverFromPersistedSession();
    }
    const json = await readJsonSafe<{
      data?: { userType?: string; tokens?: { accessToken?: string; refreshToken?: string } };
    }>(response);
    const tokens = json.data?.tokens;
    if (!tokens?.accessToken || !tokens?.refreshToken) {
      return await recoverFromPersistedSession();
    }
    const next: AuthSession = {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userType: json.data?.userType ?? session.userType,
    };
    await saveAuthSession(next);
    return next;
  } catch {
    return await recoverFromPersistedSession();
  }
}
