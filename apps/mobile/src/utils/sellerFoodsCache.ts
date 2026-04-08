type SellerFoodCacheItem = Record<string, unknown>;

let sellerFoodsCache: SellerFoodCacheItem[] | null = null;

export function getSellerFoodsCache(): SellerFoodCacheItem[] | null {
  return sellerFoodsCache;
}

export function setSellerFoodsCache(items: SellerFoodCacheItem[] | null): void {
  sellerFoodsCache = Array.isArray(items) ? items : null;
}

export function clearSellerFoodsCache(): void {
  sellerFoodsCache = null;
}

