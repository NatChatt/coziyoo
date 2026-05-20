import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export type AppSettings = {
  apiUrl: string;
  language: 'tr' | 'en';
};

type SettingsListener = (settings: AppSettings) => void;

export const DEVICE_PROFILE = 'default';
const STORAGE_KEY = '@coziyoo:settings';

function resolveDefaultLanguage(): 'tr' | 'en' {
  return 'tr';
}

const defaults: AppSettings = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').trim().replace(/\/$/, ''),
  language: resolveDefaultLanguage(),
};

const RELEASE_FALLBACK_API_URL = "https://api.coziyoo.com";

function isLocalhostLike(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0")
  );
}

function firstHostFromCandidate(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withoutProtocol = raw.replace(/^https?:\/\//i, "");
  const hostPort = withoutProtocol.split("/")[0] || "";
  const host = hostPort.split(":")[0] || "";
  return host || null;
}

function resolveDevMachineApiUrl(): string | null {
  try {
    const candidates = [
      (Constants.expoConfig as any)?.hostUri,
      (Constants as any)?.expoGoConfig?.debuggerHost,
      (Constants as any)?.manifest2?.extra?.expoClient?.hostUri,
      (Constants as any)?.manifest?.debuggerHost,
    ];
    for (const candidate of candidates) {
      const host = firstHostFromCandidate(candidate);
      if (!host) continue;
      if (host === "localhost" || host === "127.0.0.1") continue;
      return `http://${host}:3000`;
    }
  } catch {
    // ignore runtime source probing failures
  }
  return null;
}

function normalizeApiUrlForMode(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/$/, "");
  const fallback = (process.env.EXPO_PUBLIC_API_URL || RELEASE_FALLBACK_API_URL).trim().replace(/\/$/, "");
  const hasEnvApiUrl = Boolean(process.env.EXPO_PUBLIC_API_URL?.trim());
  const releaseFallback = hasEnvApiUrl && fallback ? fallback : RELEASE_FALLBACK_API_URL;
  const devMachineApi = resolveDevMachineApiUrl();
  if (!__DEV__ && hasEnvApiUrl && fallback) return fallback;
  if (!trimmed) return __DEV__ ? fallback : releaseFallback;
  if (__DEV__) {
    if (fallback && fallback !== RELEASE_FALLBACK_API_URL) {
      return fallback;
    }
    // In dev, physical devices cannot reach localhost values saved in settings.
    if (isLocalhostLike(trimmed) && devMachineApi) {
      return devMachineApi;
    }
    if (isLocalhostLike(trimmed) && fallback && !isLocalhostLike(fallback)) {
      return fallback;
    }
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (
    isLocalhostLike(lower) ||
    (lower.includes("192.168.") && lower !== releaseFallback.toLowerCase())
  ) {
    return releaseFallback;
  }
  return trimmed;
}

let current: AppSettings = { ...defaults };
let hydrated = false;
const listeners = new Set<SettingsListener>();

function normalizeLanguage(rawLanguage: unknown): 'tr' | 'en' {
  return rawLanguage === 'en' ? 'en' : 'tr';
}

function emitSettings() {
  const snapshot = { ...current };
  listeners.forEach((listener) => listener(snapshot));
}

export async function loadSettings(): Promise<AppSettings> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        const normalized = normalizeApiUrlForMode(parsed.apiUrl || '');
        current = {
          apiUrl: normalized || normalizeApiUrlForMode(defaults.apiUrl),
          language: normalizeLanguage(parsed.language),
        };
      } else {
        // Ensure first-run defaults are normalized too (critical on physical devices).
        current = {
          apiUrl: normalizeApiUrlForMode(defaults.apiUrl),
          language: defaults.language,
        };
      }
    } catch {
      // ignore and keep normalized defaults
      current = {
        apiUrl: normalizeApiUrlForMode(defaults.apiUrl),
        language: defaults.language,
      };
    } finally {
      hydrated = true;
    }
  }
  return { ...current };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const normalized = normalizeApiUrlForMode(settings.apiUrl);
  current = {
    apiUrl: normalized || normalizeApiUrlForMode(defaults.apiUrl),
    language: normalizeLanguage(settings.language),
  };
  hydrated = true;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  emitSettings();
}

export function getCurrentLanguage(): 'tr' | 'en' {
  return current.language;
}

export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
