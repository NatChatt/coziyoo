type SellerOrderCacheItem = Record<string, unknown>;

let sellerOrdersCache: SellerOrderCacheItem[] | null = null;
let sellerDisplayNameCache: string | null = null;

export function getSellerOrdersCache(): SellerOrderCacheItem[] | null {
  return sellerOrdersCache;
}

export function setSellerOrdersCache(items: SellerOrderCacheItem[] | null): void {
  sellerOrdersCache = Array.isArray(items) ? items : null;
}

export function updateSellerOrderCacheItem(
  orderId: string,
  updater: (item: SellerOrderCacheItem) => SellerOrderCacheItem,
): void {
  if (!Array.isArray(sellerOrdersCache) || sellerOrdersCache.length === 0) return;
  let changed = false;
  const next = sellerOrdersCache.map((item) => {
    const id = String(item.id ?? "");
    if (id !== orderId) return item;
    changed = true;
    return updater(item);
  });
  if (changed) sellerOrdersCache = next;
}

export function getSellerDisplayNameCache(): string | null {
  return sellerDisplayNameCache;
}

export function setSellerDisplayNameCache(name: string): void {
  sellerDisplayNameCache = name || null;
}
