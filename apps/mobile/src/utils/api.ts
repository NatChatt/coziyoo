import { loadSettings } from './settings';
import { refreshAuthSession, type AuthSession } from './auth';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  actorRole?: 'buyer' | 'seller';
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; message?: string };

function resolveRefreshBaseUrl(requestUrl: string, fallbackApiUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    return parsed.origin;
  } catch {
    return fallbackApiUrl;
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  auth: AuthSession,
  options?: RequestOptions,
  onAuthRefresh?: (session: AuthSession) => void,
): Promise<ApiResult<T>> {
  const settings = await loadSettings();
  const url = `${settings.apiUrl}${path}`;
  const method = options?.method ?? 'GET';

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${auth.accessToken}`,
    'Content-Type': 'application/json',
  };
  if (options?.actorRole && auth.userType === 'both') {
    headers['x-actor-role'] = options.actorRole;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, message: 'Bağlantı hatası' };
  }

  // Auto-refresh on 401
  if (res.status === 401 && onAuthRefresh) {
    const settings2 = await loadSettings();
    const refreshed = await refreshAuthSession(resolveRefreshBaseUrl(url, settings2.apiUrl), auth);
    if (refreshed) {
      onAuthRefresh(refreshed);
      // Retry with new token
      headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });
      } catch {
        return { ok: false, status: 0, message: 'Bağlantı hatası' };
      }
    }
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: res.status, message: 'Beklenmeyen sunucu yanıtı' };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code,
      message: json?.error?.message ?? 'Bir hata oluştu',
    };
  }

  return { ok: true, data: json.data as T };
}
