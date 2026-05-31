const sessionCache = new Map<string, unknown>();

function cacheKey(namespace: string, ownerKey: string): string {
  return `${namespace}:${ownerKey}`;
}

export function getSessionScreenCache<T>(namespace: string, ownerKey: string): T | null {
  return (sessionCache.get(cacheKey(namespace, ownerKey)) as T | undefined) ?? null;
}

export function setSessionScreenCache<T>(namespace: string, ownerKey: string, value: T | null): void {
  const key = cacheKey(namespace, ownerKey);
  if (value === null) {
    sessionCache.delete(key);
    return;
  }
  sessionCache.set(key, value);
}
