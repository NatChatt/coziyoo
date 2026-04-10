export type SellerLotSnapshot = {
  id: string;
  foodId: string;
  status: string;
  quantityAvailable: number;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  createdAt?: string | null;
};

export type SellerFoodLotSummary = {
  hasAnyLot: boolean;
  stock: number;
};

function parseApiDate(value?: string | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSellerLotSnapshot(raw: Record<string, unknown>): SellerLotSnapshot {
  return {
    id: String(raw.id ?? ""),
    foodId: String(raw.foodId ?? raw.food_id ?? "").trim(),
    status: String(raw.status ?? raw.lifecycleStatus ?? raw.lifecycle_status ?? "").trim().toLowerCase(),
    quantityAvailable: Number(raw.quantityAvailable ?? raw.quantity_available ?? 0),
    saleStartsAt: typeof raw.saleStartsAt === "string"
      ? raw.saleStartsAt
      : (typeof raw.sale_starts_at === "string" ? raw.sale_starts_at : null),
    saleEndsAt: typeof raw.saleEndsAt === "string"
      ? raw.saleEndsAt
      : (typeof raw.sale_ends_at === "string" ? raw.sale_ends_at : null),
    createdAt: typeof raw.createdAt === "string"
      ? raw.createdAt
      : (typeof raw.created_at === "string" ? raw.created_at : null),
  };
}

export function summarizeSellerLotsByFood(lots: SellerLotSnapshot[], nowMs = Date.now()): Map<string, SellerFoodLotSummary> {
  const summaries = new Map<string, SellerFoodLotSummary>();

  for (const lot of lots) {
    const foodId = lot.foodId.trim();
    if (!foodId) continue;

    const current = summaries.get(foodId) ?? { hasAnyLot: false, stock: 0 };
    current.hasAnyLot = true;

    const quantityAvailable = Number.isFinite(lot.quantityAvailable) ? lot.quantityAvailable : 0;
    const isOpenStatus = lot.status === "active" || lot.status === "open";
    if (isOpenStatus && quantityAvailable > 0) {
      const startsAt = parseApiDate(lot.saleStartsAt);
      const endsAt = parseApiDate(lot.saleEndsAt);
      const hasWindow = startsAt !== null && endsAt !== null;
      const isVisible = hasWindow
        ? startsAt <= nowMs && endsAt > nowMs
        : true;
      if (isVisible) current.stock += quantityAvailable;
    }

    summaries.set(foodId, current);
  }

  return summaries;
}
