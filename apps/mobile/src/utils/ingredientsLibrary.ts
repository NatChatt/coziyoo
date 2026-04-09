import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSession } from "./auth";

const CACHE_KEY = "@coziyoo:ingredient_library_cache_v1";
const CUSTOM_KEY = "@coziyoo:custom_ingredients_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type CacheEnvelope = {
  data: string[];
  fetchedAt: number;
  apiUrl: string;
};

// ---------- remote fetch ----------

async function fetchFromApi(
  apiUrl: string,
  auth: AuthSession,
): Promise<string[] | null> {
  try {
    const res = await fetch(`${apiUrl}/v1/seller/ingredient-templates`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "x-actor-role": "seller",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json?.data)) return null;
    return (json.data as Array<{ name: string }>)
      .map((item) => item.name)
      .filter((name) => typeof name === "string" && name.trim());
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

async function writeCache(data: string[], apiUrl: string): Promise<void> {
  try {
    const envelope: CacheEnvelope = { data, fetchedAt: Date.now(), apiUrl };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // fail silently
  }
}

// ---------- custom items ----------

export async function loadCustomIngredients(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

// ---------- merge ----------

function mergeLibraries(remote: string[], custom: string[]): string[] {
  const remoteKeys = new Set(remote.map((x) => x.toLocaleLowerCase("tr-TR")));
  const uniqueCustom = custom.filter(
    (x) => !remoteKeys.has(x.toLocaleLowerCase("tr-TR")),
  );
  return [...remote, ...uniqueCustom].sort((a, b) =>
    a.localeCompare(b, "tr-TR"),
  );
}

// ---------- public API ----------

/**
 * Returns the merged ingredient library (remote cache + custom).
 * - Uses cache if fresh (< 6 h) or if fetch fails.
 * - Fetches in the background when stale; returns stale data immediately.
 */
export async function loadIngredientLibrary(
  apiUrl: string,
  auth: AuthSession,
): Promise<string[]> {
  const [cache, custom] = await Promise.all([readCache(), loadCustomIngredients()]);

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

export async function addIngredientToLibrary(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const custom = await loadCustomIngredients();
    const key = trimmed.toLocaleLowerCase("tr-TR");
    const alreadyExists = custom.some(
      (x) => x.toLocaleLowerCase("tr-TR") === key,
    );
    if (!alreadyExists) {
      await AsyncStorage.setItem(
        CUSTOM_KEY,
        JSON.stringify([...custom, trimmed]),
      );
    }
  } catch {
    // fail silently
  }
}

/** Force-refresh the remote cache. Call after connectivity is restored. */
export async function refreshIngredientLibrary(
  apiUrl: string,
  auth: AuthSession,
): Promise<void> {
  const fresh = await fetchFromApi(apiUrl, auth);
  if (fresh) await writeCache(fresh, apiUrl);
}
