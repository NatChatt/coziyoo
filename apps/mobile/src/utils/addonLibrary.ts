import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSession } from "./auth";

const CACHE_KEY = "@coziyoo:addon_library_cache_v1";
const CUSTOM_KEY = "@coziyoo:custom_addons_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type AddonTemplate = {
  id: string;
  name: string;
  kind: "sauce" | "extra" | "appetizer";
  pricing: "free" | "paid";
  defaultPrice?: number;
  isCustom?: true;
};

type CacheEnvelope = {
  data: AddonTemplate[];
  fetchedAt: number;
  apiUrl: string;
};

// ---------- remote fetch ----------

async function fetchFromApi(
  apiUrl: string,
  auth: AuthSession,
): Promise<AddonTemplate[] | null> {
  try {
    const res = await fetch(`${apiUrl}/v1/seller/addon-templates`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "x-actor-role": "seller",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json?.data)) return null;
    return (json.data as AddonTemplate[]).filter(
      (item) => typeof item.name === "string" && item.name.trim(),
    );
  } catch {
    return null;
  }
}

// ---------- cache helpers ----------

async function readCache(): Promise<CacheEnvelope | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEnvelope) : null;
  } catch {
    return null;
  }
}

async function writeCache(
  data: AddonTemplate[],
  apiUrl: string,
): Promise<void> {
  try {
    const envelope: CacheEnvelope = { data, fetchedAt: Date.now(), apiUrl };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // fail silently
  }
}

// ---------- custom items ----------

export async function loadCustomAddons(): Promise<AddonTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as AddonTemplate[]) : [];
  } catch {
    return [];
  }
}

export async function addCustomAddon(addon: AddonTemplate): Promise<void> {
  try {
    const existing = await loadCustomAddons();
    const key = (x: AddonTemplate) =>
      `${x.name.toLocaleLowerCase("tr-TR")}|${x.kind}|${x.pricing}`;
    const alreadyExists = existing.some((x) => key(x) === key(addon));
    if (!alreadyExists) {
      const next: AddonTemplate = { ...addon, isCustom: true };
      await AsyncStorage.setItem(
        CUSTOM_KEY,
        JSON.stringify([...existing, next]),
      );
    }
  } catch {
    // fail silently
  }
}

// ---------- merge ----------

function mergeLibraries(
  remote: AddonTemplate[],
  custom: AddonTemplate[],
): AddonTemplate[] {
  const remoteKeys = new Set(
    remote.map(
      (x) => `${x.name.toLocaleLowerCase("tr-TR")}|${x.kind}|${x.pricing}`,
    ),
  );
  const uniqueCustom = custom.filter(
    (x) =>
      !remoteKeys.has(
        `${x.name.toLocaleLowerCase("tr-TR")}|${x.kind}|${x.pricing}`,
      ),
  );
  return [...remote, ...uniqueCustom].sort((a, b) =>
    a.name.localeCompare(b.name, "tr-TR"),
  );
}

// ---------- public API ----------

/**
 * Returns the merged addon library (remote cache + custom).
 * - Uses cache if fresh (< 6 h) or if fetch fails.
 * - Fetches in the background when stale; returns stale data immediately.
 */
export async function loadAddonLibrary(
  apiUrl: string,
  auth: AuthSession,
): Promise<AddonTemplate[]> {
  const [cache, custom] = await Promise.all([readCache(), loadCustomAddons()]);

  const cacheHit =
    cache !== null &&
    cache.apiUrl === apiUrl &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (cacheHit) {
    return mergeLibraries(cache.data, custom);
  }

  // Stale or missing — fetch fresh. If cache exists, return stale data
  // immediately and refresh in background; otherwise wait for the fetch.
  const fetchPromise = fetchFromApi(apiUrl, auth).then(async (fresh) => {
    if (fresh) await writeCache(fresh, apiUrl);
    return fresh;
  });

  if (cache !== null) {
    // Return stale immediately; refresh in background
    void fetchPromise;
    return mergeLibraries(cache.data, custom);
  }

  const fresh = await fetchPromise;
  return mergeLibraries(fresh ?? [], custom);
}

/** Force-refresh the remote cache. Call after connectivity is restored. */
export async function refreshAddonLibrary(
  apiUrl: string,
  auth: AuthSession,
): Promise<void> {
  const fresh = await fetchFromApi(apiUrl, auth);
  if (fresh) await writeCache(fresh, apiUrl);
}
