import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSession } from "./auth";

const CACHE_KEY = "@coziyoo:ingredient_library_cache_v2";
const CUSTOM_KEY = "@coziyoo:custom_ingredients_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type IngredientTemplate = {
  id: string;
  name: string;    // Turkish
  nameEn: string;  // English
};

type CacheEnvelope = {
  data: IngredientTemplate[];
  fetchedAt: number;
  apiUrl: string;
};

// ---------- remote fetch ----------

async function fetchFromApi(
  apiUrl: string,
  auth: AuthSession,
): Promise<IngredientTemplate[] | null> {
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
    return (json.data as Array<{ id: string; name: string; nameEn: string }>)
      .filter((item) => typeof item.name === "string" && item.name.trim())
      .map((item) => ({ id: item.id, name: item.name, nameEn: item.nameEn || item.name }));
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

async function writeCache(data: IngredientTemplate[], apiUrl: string): Promise<void> {
  try {
    const envelope: CacheEnvelope = { data, fetchedAt: Date.now(), apiUrl };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // fail silently
  }
}

// ---------- custom items ----------

export async function loadCustomIngredients(): Promise<IngredientTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<string | IngredientTemplate>;
    // Handle legacy string-only format
    return parsed.map((item) =>
      typeof item === "string"
        ? { id: `custom:${item}`, name: item, nameEn: item }
        : item,
    );
  } catch {
    return [];
  }
}

// ---------- merge ----------

function mergeLibraries(
  remote: IngredientTemplate[],
  custom: IngredientTemplate[],
): IngredientTemplate[] {
  const remoteKeys = new Set(remote.map((x) => x.name.toLocaleLowerCase("tr-TR")));
  const uniqueCustom = custom.filter(
    (x) => !remoteKeys.has(x.name.toLocaleLowerCase("tr-TR")),
  );
  return [...remote, ...uniqueCustom].sort((a, b) =>
    a.name.localeCompare(b.name, "tr-TR"),
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
): Promise<IngredientTemplate[]> {
  const [cache, custom] = await Promise.all([readCache(), loadCustomIngredients()]);

  const cacheHit =
    cache !== null &&
    cache.apiUrl === apiUrl &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (cacheHit) {
    return mergeLibraries(cache.data, custom);
  }

  const fetchPromise = fetchFromApi(apiUrl, auth).then(async (fresh) => {
    if (fresh) await writeCache(fresh, apiUrl);
    return fresh;
  });

  if (cache !== null) {
    void fetchPromise;
    return mergeLibraries(cache.data, custom);
  }

  const fresh = await fetchPromise;
  return mergeLibraries(fresh ?? [], custom);
}

export async function addIngredientToLibrary(name: string, nameEn?: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const custom = await loadCustomIngredients();
    const key = trimmed.toLocaleLowerCase("tr-TR");
    const alreadyExists = custom.some((x) => x.name.toLocaleLowerCase("tr-TR") === key);
    if (!alreadyExists) {
      const newItem: IngredientTemplate = {
        id: `custom:${trimmed}`,
        name: trimmed,
        nameEn: nameEn?.trim() || trimmed,
      };
      await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify([...custom, newItem]));
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
