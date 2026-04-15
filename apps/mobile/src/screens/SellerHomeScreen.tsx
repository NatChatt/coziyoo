import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Easing, FlatList, Platform, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerFoodsCache, setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { getSellerOrdersCache, setSellerOrdersCache, getSellerDisplayNameCache, setSellerDisplayNameCache } from "../utils/sellerOrdersCache";
import { getSellerMeCache } from "../utils/sellerProfileCache";
import { normalizeSellerLotSnapshot, summarizeSellerLotsByFood } from "../utils/sellerLotSummary";
import { subscribeSellerOrdersRealtime } from "../utils/realtime";
import { getStatusInfo } from "../components/StatusBadge";
import { formatCopy, t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFinance: () => void;
  onOpenFoodsManager: (foodId?: string) => void;
  onOpenOrder: (orderId: string) => void;
  onSwitchToBuyer?: () => void;
};

type SellerOrder = {
  id: string;
  sellerId?: string | null;
  orderNo?: string | null;
  buyerName?: string | null;
  primaryFoodName?: string | null;
  itemCount?: number | null;
  status: string;
  deliveryType?: "pickup" | "delivery" | string;
  requestedDeliveryType?: "pickup" | "delivery" | string;
  activeDeliveryType?: "pickup" | "delivery" | string;
  sellerDecisionState?: "pending" | "revised" | "approved" | "rejected" | string;
  totalPrice: number;
  createdAt?: string;
  updatedAt?: string;
  buyerProgressStatus?: string | null;
  buyerProgressAt?: string | null;
  deliveryAddress?: { distanceKm?: number | null; durationMinutes?: number | null } | null;
};

type SellerAction =
  | { label: string; toStatus: "preparing" | "ready" | "in_delivery" | "approaching" | "at_door" | "delivered" | "completed" | "seller_approved" | "rejected" | "cancelled"; tone: "preparing" | "ready" | "in_delivery" | "approaching" | "at_door" | "delivered" | "approve" | "reject" };

type OrderGroupKey = "preparing" | "route" | "done";

type ActiveFood = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  hasAnyLot: boolean;
  stock: number;
};
const BUSINESS_DAY_RESET_HOUR = 5;
const TURKEY_TIMEZONE = "Europe/Istanbul";
const SELLER_FAST_REFRESH_MS = 3_000;
const SELLER_IDLE_REFRESH_MS = 6_000;
function pickupBuyerCurrentStepLabel(status?: string | null): string | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "in_delivery") return "Yoldayım";
  if (normalized === "approaching") return "Geliyorum";
  if (normalized === "at_door") return "Kapıdayım";
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "t", "yes", "y", "aktif", "active"].includes(normalized);
  }
  return false;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseApiDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeCountryCode(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (raw === "TR" || raw === "TURKIYE" || raw === "TÜRKİYE" || raw === "TURKEY") return "TR";
  return raw;
}

function normalizeStatusValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDeliveryTypeValue(value: unknown): "pickup" | "delivery" | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pickup" || normalized === "delivery") return normalized;
  return undefined;
}

function businessDayKey(date: Date, useTurkeyTime: boolean): string {
  const shifted = new Date(date.getTime() - (BUSINESS_DAY_RESET_HOUR * 60 * 60 * 1000));
  if (useTurkeyTime) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TURKEY_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(shifted);
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";
    return `${year}-${month}-${day}`;
  }
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const d = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isCurrentBusinessDay(date: Date, reference: Date, useTurkeyTime: boolean): boolean {
  return businessDayKey(date, useTurkeyTime) === businessDayKey(reference, useTurkeyTime);
}

function formatOrderDateTime(value?: string): string {
  const parsed = parseApiDate(value);
  if (!parsed) return "-";
  const day = parsed.getDate().toString().padStart(2, "0");
  const month = (parsed.getMonth() + 1).toString().padStart(2, "0");
  const hours = parsed.getHours().toString().padStart(2, "0");
  const minutes = parsed.getMinutes().toString().padStart(2, "0");
  return `${day}.${month} / ${hours}:${minutes}`;
}

function orderTimeForSort(order: SellerOrder): number {
  return (parseApiDate(order.createdAt) ?? parseApiDate(order.updatedAt))?.getTime() ?? 0;
}

function formatElapsed(value: string | undefined, nowMs: number): string {
  const parsed = parseApiDate(value);
  if (!parsed) return t('status.seller.home.noElapsed');
  const diffMs = Math.max(0, nowMs - parsed.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return t('status.seller.home.justArrived');
  if (totalMinutes < 60) return formatCopy('status.seller.home.minutesElapsed', { count: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return formatCopy('status.seller.home.hoursElapsed', { hours, minutes });
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return formatCopy('status.seller.home.daysElapsed', { days, hours: remHours });
}

function statusLabel(status: string, deliveryType?: string): string {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "cancelled" || normalized === "rejected") return t('status.seller.home.cancelled');
  if (deliveryType === "delivery" && normalized === "ready") return t('cta.seller.home.markReady');
  if (deliveryType === "pickup" && normalized === "ready") return t('status.seller.home.pickupReady');
  if (deliveryType === "pickup" && ["in_delivery", "approaching", "at_door"].includes(normalized)) {
    return getStatusInfo(normalized, undefined).label;
  }
  return getStatusInfo(normalized, deliveryType).label;
}

function buyerProgressLabel(status?: string | null): string | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "in_delivery") return t('status.seller.home.buyerOnWay');
  if (normalized === "approaching") return t('status.seller.home.buyerComing');
  if (normalized === "at_door") return t('status.seller.home.buyerAtDoor');
  return null;
}

function statusTone(status: string, deliveryType?: string): { bg: string; border: string; text: string } {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  const info = getStatusInfo(
    normalized,
    deliveryType === "pickup" && ["in_delivery", "approaching", "at_door"].includes(normalized)
      ? undefined
      : deliveryType,
  );
  const borders: Record<string, string> = {
    preparing: "#F5C27A",
    ready: "#79C796",
    in_delivery: "#AFC6FF",
    approaching: "#9EDBD2",
    at_door: "#9EDBD2",
    delivered: "#79C796",
    completed: "#79C796",
    cancelled: "#F2B5B0",
    rejected: "#F2B5B0",
  };
  return {
    bg: info.bg,
    border: borders[normalized] ?? "#D6CCBD",
    text: info.color,
  };
}

function normalizeDisplayStatus(status: string, deliveryType?: string): string {
  if (status === "cancelled" || status === "rejected") return status;
  if (status === "completed") return "delivered";
  if (status === "delivered" || status === "at_door") return status;
  if (status === "in_delivery") return "in_delivery";
  if (status === "ready") return "ready";
  if (["pending_seller_approval", "pending_buyer_confirmation", "seller_approved", "awaiting_payment", "paid", "preparing"].includes(status)) return status;
  return status;
}

function cardActionByStatus(status: string, deliveryType?: string): SellerAction | null {
  const pickup = deliveryType === "pickup";
  if (status === "pending_seller_approval") {
    return { label: t('cta.seller.home.approveOrder'), toStatus: "seller_approved", tone: "approve" };
  }
  if (pickup) {
    return null;
  }
  if (status === "paid") {
    return { label: t('cta.seller.home.startPreparing'), toStatus: "preparing", tone: "preparing" };
  }
  if (!pickup && status === "preparing") {
    return { label: t('cta.seller.home.markReady'), toStatus: "ready", tone: "ready" };
  }
  if (!pickup && status === "ready") {
    return { label: t('cta.seller.home.leftForDelivery'), toStatus: "in_delivery", tone: "in_delivery" };
  }
  if (status === "in_delivery") return { label: t('cta.seller.home.approaching'), toStatus: "approaching", tone: "approaching" };
  if (status === "approaching") return { label: t('cta.seller.home.atDoor'), toStatus: "at_door", tone: "at_door" };
  if (!pickup && status === "at_door") return null;
  return null;
}

function toneFromStatus(status: string, deliveryType?: string): SellerAction["tone"] | null {
  if (status === "pending_seller_approval") return "approve";
  if (status === "pending_buyer_confirmation") return "preparing";
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "preparing") return "preparing";
  if (normalized === "ready") return "ready";
  if (normalized === "in_delivery") return "in_delivery";
  if (normalized === "approaching") return "approaching";
  if (normalized === "at_door") return "at_door";
  if (normalized === "delivered") return "delivered";
  return null;
}

function orderGroupKey(status: string, deliveryType?: string): OrderGroupKey {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (normalized === "in_delivery" || normalized === "approaching" || normalized === "at_door") return "route";
  if (normalized === "delivered" || normalized === "completed" || normalized === "cancelled" || normalized === "rejected") return "done";
  return "preparing";
}

function sellerOrdersSignature(items: SellerOrder[]): string {
  return items
    .map((order) => [
      order.id ?? "",
      order.status ?? "",
      order.updatedAt ?? "",
      order.buyerProgressStatus ?? "",
      order.buyerProgressAt ?? "",
      order.totalPrice ?? "",
      order.deliveryType ?? "",
      order.requestedDeliveryType ?? "",
      order.activeDeliveryType ?? "",
      order.sellerDecisionState ?? "",
    ].join("|"))
    .join("||");
}

function normalizeSellerOrder(raw: Record<string, unknown>): SellerOrder {
  const id = String(raw.id ?? "");
  return {
    id,
    sellerId: typeof raw.sellerId === "string" ? raw.sellerId : (typeof raw.seller_id === "string" ? raw.seller_id : null),
    orderNo: typeof raw.orderNo === "string" ? raw.orderNo : `#${id.slice(0, 8).toUpperCase()}`,
    buyerName: typeof raw.buyerName === "string" ? raw.buyerName : (typeof raw.buyer_name === "string" ? raw.buyer_name : null),
    primaryFoodName: typeof raw.primaryFoodName === "string" ? raw.primaryFoodName : (typeof raw.primary_food_name === "string" ? raw.primary_food_name : null),
    itemCount: Number(raw.itemCount ?? raw.item_count ?? 0),
    status: normalizeStatusValue(raw.status),
    deliveryType: normalizeDeliveryTypeValue(typeof raw.deliveryType === "string" ? raw.deliveryType : raw.delivery_type),
    requestedDeliveryType:
      normalizeDeliveryTypeValue(
        typeof raw.requestedDeliveryType === "string"
          ? raw.requestedDeliveryType
          : raw.requested_delivery_type
      ),
    activeDeliveryType:
      normalizeDeliveryTypeValue(
        typeof raw.activeDeliveryType === "string"
          ? raw.activeDeliveryType
          : raw.active_delivery_type
      ),
    sellerDecisionState:
      normalizeStatusValue(
        typeof raw.sellerDecisionState === "string"
          ? raw.sellerDecisionState
          : raw.seller_decision_state
      ) || undefined,
    totalPrice: Number(raw.totalPrice ?? raw.total_price ?? 0),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : (typeof raw.created_at === "string" ? raw.created_at : undefined),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (typeof raw.updated_at === "string" ? raw.updated_at : undefined),
    buyerProgressStatus:
      typeof raw.buyerProgressStatus === "string"
        ? raw.buyerProgressStatus
        : (typeof raw.buyer_progress_status === "string" ? raw.buyer_progress_status : null),
    buyerProgressAt:
      typeof raw.buyerProgressAt === "string"
        ? raw.buyerProgressAt
        : (typeof raw.buyer_progress_at === "string" ? raw.buyer_progress_at : null),
    deliveryAddress: (() => {
      const addr = raw.deliveryAddress ?? raw.delivery_address;
      if (!addr || typeof addr !== "object") return null;
      const a = addr as Record<string, unknown>;
      const distanceKm = toFiniteNumber(a.distanceKm);
      const durationMinutes = toFiniteNumber(a.durationMinutes);
      return { distanceKm, durationMinutes };
    })(),
  };
}

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFinance,
  onOpenFoodsManager,
  onOpenOrder,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(() => getSellerOrdersCache() === null && getSellerFoodsCache() === null);
  const [displayName, setDisplayName] = useState<string>(() => getSellerDisplayNameCache() ?? "Usta");
  const [orders, setOrders] = useState<SellerOrder[]>(() => {
    const cached = getSellerOrdersCache();
    if (!Array.isArray(cached)) return [];
    return cached as SellerOrder[];
  });
  const [rating, setRating] = useState<{ avg: number; count: number } | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFoods, setActiveFoods] = useState<ActiveFood[]>(() => {
    const cached = getSellerFoodsCache();
    if (!Array.isArray(cached)) return [];
    return cached
      .map((f) => ({
        id: String(f.id ?? ""),
        name: String(f.name ?? ""),
        price: Number(f.price ?? 0),
        isActive: toBool(f.isActive),
        hasAnyLot: toBool(f.hasAnyLot ?? f.has_any_lot),
        stock: Number(f.stock ?? 0),
      }));
  });
  const [activePage, setActivePage] = useState(0);
  const [celebrationOrderId, setCelebrationOrderId] = useState<string | null>(null);
  const [newOrderUntilById, setNewOrderUntilById] = useState<Record<string, number>>({});
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [sellerCountryCode, setSellerCountryCode] = useState<string>(() => normalizeCountryCode(getSellerMeCache()?.countryCode ?? ""));
  const appStateRef = useRef(AppState.currentState);
  const deliveredEmojiScale = useRef(new Animated.Value(0.4)).current;
  const deliveredEmojiOpacity = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;
  const actionInFlightRef = useRef<Record<string, boolean>>({});
  const lastOrdersSignatureRef = useRef<string>(sellerOrdersSignature(orders));
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const hasSeenInitialOrdersRef = useRef(false);
  const refreshOrdersOnlyRef = useRef<(baseUrl?: string) => Promise<void>>(async () => {});
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  useEffect(() => {
    seenOrderIdsRef.current = new Set();
    hasSeenInitialOrdersRef.current = false;
    setNewOrderUntilById({});
  }, [currentAuth.userId]);

  useEffect(() => {
    const id = setInterval(() => setClockMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function fetchWithAuth(path: string, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
    });
    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { headers });
    if (res.status !== 401 && res.status !== 403) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { headers: makeHeaders(persisted) });
      if (res.status !== 401 && res.status !== 403) return res;
    }

    const refreshed = await refreshAuthSession(baseUrl, persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      headers: makeHeaders(refreshed),
    });
  }

  async function fetchWithAuthInit(path: string, init: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init.headers as Record<string, string> | undefined),
    });
    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401 && res.status !== 403) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401 && res.status !== 403) return res;
    }

    const refreshed = await refreshAuthSession(baseUrl, persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: makeHeaders(refreshed),
    });
  }

  async function refreshOrdersOnly(baseUrl = apiUrl): Promise<void> {
    const ordersRes = await fetchWithAuth("/v1/seller/orders?page=1&pageSize=200", baseUrl);
    if (!ordersRes.ok) {
      return;
    }
    const ordersJson = await ordersRes.json().catch(() => ({}));
    let sellerOrders: SellerOrder[] = Array.isArray(ordersJson?.data)
      ? ordersJson.data.map((row: unknown) => normalizeSellerOrder((row ?? {}) as Record<string, unknown>))
      : [];

    // Keep home feed aligned with fallback list when seller endpoint returns empty.
    if (sellerOrders.length === 0) {
      const fallbackRes = await fetchWithAuth("/v1/orders?page=1&pageSize=200&role=seller", baseUrl);
      const fallbackJson = await fallbackRes.json().catch(() => ({}));
      if (fallbackRes.ok && Array.isArray(fallbackJson?.data)) {
        const normalizedFallback = (fallbackJson.data as unknown[]).map((row: unknown) => normalizeSellerOrder((row ?? {}) as Record<string, unknown>));
        const fromAll = normalizedFallback.filter((row) => row.sellerId === currentAuth.userId);
        sellerOrders = fromAll.length > 0 ? fromAll : normalizedFallback;
      }
    }

    const nextSignature = sellerOrdersSignature(sellerOrders);
    const canSkipStateUpdate = hasSeenInitialOrdersRef.current && nextSignature === lastOrdersSignatureRef.current;
    lastOrdersSignatureRef.current = nextSignature;
    if (canSkipStateUpdate) return;

    setSellerOrdersCache(sellerOrders as Record<string, unknown>[]);
    const now = Date.now();
    setNewOrderUntilById((prev) => {
      const next: Record<string, number> = {};
      for (const [id, expiresAt] of Object.entries(prev)) {
        if (expiresAt > now) next[id] = expiresAt;
      }
      for (const order of sellerOrders) {
        if (!seenOrderIdsRef.current.has(order.id)) {
          if (hasSeenInitialOrdersRef.current) next[order.id] = now + 75_000;
          seenOrderIdsRef.current.add(order.id);
        }
      }
      hasSeenInitialOrdersRef.current = true;
      return next;
    });
    setOrders(sellerOrders);
  }

  async function load() {
    const hasCache = getSellerOrdersCache() !== null || getSellerFoodsCache() !== null;
    if (!hasCache) setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);

      // Orders are highest priority; do not block them behind profile/foods fetches.
      await refreshOrdersOnly(baseUrl);

      const [profileRes, foodsRes, lotsRes, reviewsRes, meRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/seller/foods", baseUrl),
        fetchWithAuth("/v1/seller/lots", baseUrl),
        fetchWithAuth("/v1/seller/reviews?pageSize=1", baseUrl),
        fetchWithAuth("/v1/auth/me", baseUrl),
      ]);

      const profileJson = await profileRes.json().catch(() => ({}));
      if (profileRes.ok) {
        const name = profileJson?.data?.displayName?.trim() || "Usta";
        setDisplayName(name);
        setSellerDisplayNameCache(name);
      }

      const reviewsJson = await reviewsRes.json().catch(() => ({}));
      if (reviewsRes.ok && reviewsJson?.data?.summary) {
        const { averageRating, totalReviews } = reviewsJson.data.summary;
        setRating({ avg: Number(averageRating ?? 0), count: Number(totalReviews ?? 0) });
      }

      if (meRes.ok) {
        const meJson = await meRes.json().catch(() => ({}));
        const cc = normalizeCountryCode(meJson?.data?.countryCode ?? "");
        if (cc) setSellerCountryCode(cc);
      }

      if (foodsRes.ok) {
        const foodsJson = await foodsRes.json().catch(() => ({}));
        const lotsJson = lotsRes.ok ? await lotsRes.json().catch(() => ({})) : {};
        const lotSummaries = lotsRes.ok && Array.isArray((lotsJson as Record<string, unknown>)?.data)
          ? summarizeSellerLotsByFood((((lotsJson as Record<string, unknown>).data) as Record<string, unknown>[]).map((item) => normalizeSellerLotSnapshot(item)))
          : new Map<string, { hasAnyLot: boolean; stock: number }>();
        if (Array.isArray(foodsJson?.data)) {
          const foods = (foodsJson.data as Record<string, unknown>[]).map((f) => ({
            ...f,
            id: String(f.id ?? ""),
            name: String(f.name ?? ""),
            price: Number(f.price ?? 0),
            isActive: toBool(f.isActive ?? f.is_active),
            hasAnyLot: lotSummaries.get(String(f.id ?? ""))?.hasAnyLot ?? toBool(f.hasAnyLot ?? f.has_any_lot),
            stock: lotSummaries.get(String(f.id ?? ""))?.stock ?? Number(f.stock ?? 0),
          }));
          setSellerFoodsCache(foods);
          setActiveFoods(
            foods
              .map((f) => ({
                id: String(f.id ?? ""),
                name: String(f.name ?? ""),
                price: Number(f.price ?? 0),
                isActive: toBool(f.isActive),
                hasAnyLot: toBool(f.hasAnyLot),
                stock: Number(f.stock ?? 0),
              })),
          );
          console.info("[seller-home] foods loaded", {
            count: foods.length,
            activeCount: foods.filter((f) => toBool(f.isActive)).length,
            userId: currentAuth.userId,
          });
        }
      } else {
        const foodsError = await foodsRes.json().catch(() => ({}));
        console.warn("[seller-home] foods fetch failed", {
          status: foodsRes.status,
          message: foodsError?.error?.message ?? null,
          userId: currentAuth.userId,
          actorRole: "seller",
        });
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshOrdersOnlyRef.current = refreshOrdersOnly;
    loadRef.current = load;
  });

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const unsubscribe = subscribeSellerOrdersRealtime(currentAuth.userId, () => {
      void refreshOrdersOnlyRef.current();
    });
    return unsubscribe;
  }, [currentAuth.userId]);

  // Reload when app returns to foreground (covers case where realtime is not configured)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "active") void loadRef.current();
    });
    return () => sub.remove();
  }, []);

  const todayOrders = useMemo(() => {
    const now = new Date();
    const useTurkeyTime = sellerCountryCode === "TR";
    const scoped = orders.filter((o) => {
      if (o.sellerId && o.sellerId !== currentAuth.userId) return false;
      if (!["pending_seller_approval", "pending_buyer_confirmation", "seller_approved", "awaiting_payment", "paid", "preparing", "ready", "in_delivery", "approaching", "at_door", "delivered", "completed", "cancelled", "rejected"].includes(o.status)) return false;
      return true;
    });
    const datedScopedCount = scoped.filter((o) => Boolean(parseApiDate(o.createdAt) ?? parseApiDate(o.updatedAt))).length;
    const filtered = scoped.filter((o) => {
      const receivedAt = parseApiDate(o.createdAt) ?? parseApiDate(o.updatedAt);
      if (!receivedAt) return false;
      return isCurrentBusinessDay(receivedAt, now, useTurkeyTime);
    });
    // Sadece tarih parse edilemeyen edge-case durumda fallback uygula.
    return datedScopedCount === 0 ? scoped : filtered;
  }, [orders, currentAuth.userId, clockMs, sellerCountryCode]);
  const hasUrgentSellerOrders = useMemo(() => todayOrders.some((order) => (
    order.status === "pending_seller_approval" ||
    order.status === "pending_buyer_confirmation" ||
    (order.requestedDeliveryType === "delivery" && order.activeDeliveryType !== "delivery")
  )), [todayOrders]);

  // Polling fallback: refresh more aggressively while seller action is pending.
  useEffect(() => {
    const id = setInterval(() => {
      if (appStateRef.current !== "active") return;
      if (activePage !== 0) return;
      if (updatingOrderId) return;
      void refreshOrdersOnlyRef.current();
    }, hasUrgentSellerOrders ? SELLER_FAST_REFRESH_MS : SELLER_IDLE_REFRESH_MS);
    return () => clearInterval(id);
  }, [activePage, updatingOrderId, hasUrgentSellerOrders]);

  const groupedOrders = useMemo(() => {
    const preparing: SellerOrder[] = [];
    const route: SellerOrder[] = [];
    const done: SellerOrder[] = [];
    for (const order of todayOrders) {
      const key = orderGroupKey(order.status, order.deliveryType);
      if (key === "preparing") preparing.push(order);
      else if (key === "route") route.push(order);
      else done.push(order);
    }
    preparing.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    route.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    done.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    return { preparing, route, done };
  }, [todayOrders]);

  const orderSections = useMemo(
    (): Array<{ key: OrderGroupKey; title: string; data: SellerOrder[] }> => ([
      { key: "preparing", title: t('headline.seller.home.groupPreparing'), data: groupedOrders.preparing },
      { key: "route", title: t('headline.seller.home.groupRoute'), data: groupedOrders.route },
      { key: "done", title: t('headline.seller.home.groupDone'), data: groupedOrders.done },
    ]),
    [groupedOrders],
  );

  const shouldAnimatePulse = useMemo(() => {
    const hasDoorOrder = todayOrders.some((order) => normalizeDisplayStatus(order.status, order.deliveryType) === "at_door");
    const hasNewOrder = Object.values(newOrderUntilById).some((expiresAt) => expiresAt > clockMs);
    return hasDoorOrder || hasNewOrder;
  }, [todayOrders, newOrderUntilById, clockMs]);

  useEffect(() => {
    if (!shouldAnimatePulse) {
      pulseValue.stopAnimation();
      pulseValue.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseValue, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseValue, shouldAnimatePulse]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function changeStatus(orderId: string, toStatus: "ready" | "in_delivery" | "approaching" | "at_door" | "delivered" | "preparing" | "completed" | "seller_approved" | "rejected" | "cancelled"): Promise<void> {
    const res = await fetchWithAuthInit(
      `/v1/orders/${orderId}/status`,
      {
        method: "POST",
        body: JSON.stringify({ toStatus }),
      },
      apiUrl,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? "Durum güncellenemedi");
  }

  async function runCardAction(orderId: string, action: SellerAction) {
    if (actionInFlightRef.current[orderId]) return;
    actionInFlightRef.current[orderId] = true;
    try {
      setUpdatingOrderId(orderId);
      await changeStatus(orderId, action.toStatus);
      const nowIso = new Date().toISOString();
      setOrders((prev) => prev.map((item) => (
        item.id === orderId
          ? { ...item, status: action.toStatus, updatedAt: nowIso }
          : item
      )));
      if (action.toStatus === "delivered") {
        setCelebrationOrderId(orderId);
        deliveredEmojiScale.setValue(0.4);
        deliveredEmojiOpacity.setValue(0);
        Animated.sequence([
          Animated.parallel([
            Animated.timing(deliveredEmojiOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
            Animated.spring(deliveredEmojiScale, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
          ]),
          Animated.delay(520),
          Animated.parallel([
            Animated.timing(deliveredEmojiOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
            Animated.timing(deliveredEmojiScale, { toValue: 1.25, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
        ]).start(() => setCelebrationOrderId(null));
      }
      await load();
    } catch (error) {
      Alert.alert(t('headline.common.error'), error instanceof Error ? error.message : t('error.seller.home.actionFailed'));
    } finally {
      delete actionInFlightRef.current[orderId];
      setUpdatingOrderId(null);
    }
  }

  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View style={styles.container}>
      <View style={styles.stickyTop}>
        {/* Greeting + Avatar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title} numberOfLines={1}>{formatCopy('headline.seller.home.greeting', { name: displayName })}</Text>
            {rating !== null && rating.count > 0 ? (
              <View style={styles.ratingRow}>
                <Text style={styles.ratingStar}>★</Text>
                <Text style={styles.ratingAvg}>{rating.avg.toFixed(1)}</Text>
                <Text style={styles.ratingCount}>{formatCopy('status.seller.home.ratingCount', { count: rating.count })}</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity style={styles.avatar} onPress={onOpenProfile} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Üst Hızlı Butonlar */}
        <View style={styles.quickButtonsRow}>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={() => onOpenFoodsManager()}>
            <Text style={styles.quickButtonText}>{t('cta.seller.home.foodsManager')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLpiPill} activeOpacity={0.85} onPress={onOpenFinance}>
            <Text style={[styles.quickButtonText, styles.quickWalletButtonText]}>{t('cta.seller.home.wallet')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats header */}
      <View style={styles.ordersHead}>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => setActivePage(0)}>
          <Text style={[styles.statCount, activePage === 0 && styles.statCountActive]}>{loading ? "—" : todayOrders.length}</Text>
          <Text style={[styles.statLabel, activePage === 0 && styles.statLabelActive]}>{t('headline.seller.home.todayOrders')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBlock} activeOpacity={0.75} onPress={() => setActivePage(1)}>
          <Text style={[styles.statCount, activePage === 1 && styles.statCountActive]}>{loading ? "—" : activeFoods.length}</Text>
          <Text style={[styles.statLabel, activePage === 1 && styles.statLabelActive]}>{t('headline.seller.home.activeFoods')}</Text>
        </TouchableOpacity>
      </View>

      {activePage === 0 ? (
        loading ? (
          <View style={[styles.ordersContent, styles.listContentGrow]}>
            <View style={styles.ordersSection}>
              <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
              <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
            </View>
          </View>
        ) : todayOrders.length === 0 ? (
          <FlatList
            style={styles.ordersScroll}
            data={[]}
            keyExtractor={(item) => item}
            renderItem={null}
            contentContainerStyle={[styles.ordersContent, styles.listContentGrow]}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            ListEmptyComponent={
              <View style={styles.ordersSection}>
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>{t('headline.seller.home.emptyOrdersTitle')}</Text>
                  <Text style={styles.emptySub}>{t('helper.seller.home.emptyOrdersSubtitle')}</Text>
                </View>
              </View>
            }
            ListFooterComponent={onSwitchToBuyer ? (
              <View style={styles.actions}>
                <TouchableOpacity activeOpacity={0.86} style={styles.switchRoleButton} onPress={onSwitchToBuyer}>
                  <Text style={styles.switchRoleButtonText}>{t('cta.seller.home.switchToBuyer')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          />
        ) : (
          <SectionList
            style={styles.ordersScroll}
            sections={orderSections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.ordersContent}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            stickySectionHeadersEnabled={false}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={8}
            removeClippedSubviews={Platform.OS === "android"}
            renderSectionHeader={({ section }) => (
              <View style={styles.groupSection}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{section.title}</Text>
                  <Text style={styles.groupCount}>{section.data.length}</Text>
                </View>
                {section.data.length === 0 ? (
                  <View style={styles.groupEmptyCard}>
                    <Text style={styles.groupEmptyText}>{t('helper.seller.home.groupEmpty')}</Text>
                  </View>
                ) : null}
              </View>
            )}
            renderItem={({ item, section, index }) => {
              const action = cardActionByStatus(item.status, item.deliveryType);
              const rejectAction: SellerAction | null = item.status === "pending_seller_approval"
                ? { label: t('cta.seller.home.rejectOrder'), toStatus: "rejected", tone: "reject" }
                : null;
              const isUpdating = updatingOrderId === item.id || Boolean(actionInFlightRef.current[item.id]);
              const buyerFlowText = buyerProgressLabel(
                item.buyerProgressStatus || (item.deliveryType === "pickup" ? item.status : null),
              );
              const isPickupOrder = String(item.deliveryType ?? "").trim().toLowerCase() === "pickup";
              const statusText = statusLabel(item.status, item.deliveryType);
              const passiveTone = toneFromStatus(item.status, item.deliveryType);
              const resolvedTone = action?.tone ?? passiveTone;
              const canRunAction = Boolean(action);
              const normalizedStatus = normalizeDisplayStatus(item.status, item.deliveryType);
              const showSmallThumb = normalizedStatus === "delivered";
              const isDoorStep = normalizedStatus === "at_door";
              const isNewOrder = (newOrderUntilById[item.id] ?? 0) > clockMs;
              const isLastInSection = index === section.data.length - 1;
              const buyerRequestedDelivery = item.requestedDeliveryType === "delivery" && item.activeDeliveryType !== "delivery";
              const shouldOpenDecisionScreen = buyerRequestedDelivery && item.status === "pending_seller_approval";
              const pickupCurrentStepLabel = isPickupOrder
                ? pickupBuyerCurrentStepLabel(item.buyerProgressStatus || item.status)
                : null;
              const distanceKm = item.deliveryAddress?.distanceKm;
              const durationMinutes = item.deliveryAddress?.durationMinutes;
              const hasDeliveryDistance = typeof distanceKm === "number" && Number.isFinite(distanceKm);
              const hasDeliveryDuration = typeof durationMinutes === "number" && Number.isFinite(durationMinutes);
              const hasRequiredDeliveryMetrics = hasDeliveryDistance && hasDeliveryDuration;
              const lockDeliveryDecision = shouldOpenDecisionScreen && !hasRequiredDeliveryMetrics;
              return (
                <View style={[styles.orderCard, isLastInSection && styles.orderCardLast]}>
                  {isDoorStep ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.kapidaHighlightLayer,
                        {
                          opacity: pulseValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.08, 0.2],
                          }),
                        },
                      ]}
                    />
                  ) : null}
                  {isNewOrder ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.newHighlightLayer,
                        {
                          opacity: pulseValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.12, 0.24],
                          }),
                        },
                      ]}
                    />
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.82}
                    disabled={lockDeliveryDecision}
                    onPress={() => {
                      if (lockDeliveryDecision) return;
                      onOpenOrder(item.id);
                    }}
                  >
                    <View style={styles.orderTopRow}>
                      <View style={styles.orderTitleWrap}>
                        <View style={styles.orderTitleRow}>
                          <Text style={styles.orderNo} numberOfLines={1}>
                            {item.primaryFoodName?.trim() || item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}
                            {item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                          </Text>
                          {isNewOrder ? (
                            <View style={styles.newBadge}>
                              <Text style={styles.newBadgeText}>{t('status.seller.home.new')}</Text>
                            </View>
                          ) : null}
                        </View>
                        {buyerFlowText ? <Text style={styles.orderBuyerFlowMeta}>{buyerFlowText}</Text> : null}
                        {isPickupOrder && pickupCurrentStepLabel ? (
                          <View style={styles.pickupFlowChipRow}>
                            <View style={[styles.pickupFlowChip, styles.pickupFlowChipActive]}>
                              <Text style={[styles.pickupFlowChipText, styles.pickupFlowChipTextActive]}>
                                {pickupCurrentStepLabel}
                              </Text>
                            </View>
                          </View>
                        ) : null}
                        <Text style={styles.orderMeta}>{formatCopy('status.seller.orders.buyer', { name: item.buyerName || "-" })}</Text>
                      </View>
                      <View style={styles.orderTopRight}>
                        <Text style={styles.orderIdText}>{item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                        <Text style={styles.orderDateText}>{formatOrderDateTime(item.createdAt)}</Text>
                      </View>
                    </View>
                    {buyerRequestedDelivery ? (
                      <View style={styles.deliveryRequestInlineBanner}>
                        <Text style={styles.deliveryRequestInlineTitle}>{t('helper.seller.orderDetail.deliveryRequestTitle')}</Text>
                        {hasRequiredDeliveryMetrics ? (
                          <Text style={styles.deliveryRequestInlineMetricText}>
                            {[
                              formatCopy('helper.seller.orderDetail.deliveryDistance', { km: Number(distanceKm).toFixed(1) }),
                              formatCopy('helper.seller.orderDetail.deliveryDuration', { min: Math.round(Number(durationMinutes)) }),
                            ].join('  ·  ')}
                          </Text>
                        ) : (
                          <Text style={styles.deliveryRequestInlineWarningText}>
                            {t('helper.seller.home.deliveryMetricsRequired')}
                          </Text>
                        )}
                        <Text style={styles.deliveryRequestInlineText}>
                          {hasRequiredDeliveryMetrics
                            ? t('helper.seller.home.deliveryRequestHint')
                            : t('helper.seller.home.deliveryMetricsPendingHint')}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.orderBottomRow}>
                      <Text style={styles.orderTotal}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                      <View style={styles.orderBottomRight}>
                        <Text style={styles.orderElapsedText}>{formatElapsed(item.createdAt, clockMs)}</Text>
                        {showSmallThumb ? <Text style={styles.orderThumbSmall}>👍</Text> : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                  {resolvedTone ? (
                    <View style={styles.cardActionRow}>
                      {celebrationOrderId === item.id ? (
                        <Animated.View
                          pointerEvents="none"
                          style={[
                            styles.cardCelebrateEmojiWrap,
                            {
                              opacity: deliveredEmojiOpacity,
                              transform: [{ scale: deliveredEmojiScale }],
                            },
                          ]}
                        >
                          <Text style={styles.cardCelebrateEmoji}>👍</Text>
                        </Animated.View>
                      ) : null}
                      {rejectAction ? (
                        <TouchableOpacity
                          activeOpacity={0.86}
                          style={[styles.cardActionBtn, styles.cardActionBtnReject, isUpdating && styles.cardActionBtnDisabled]}
                          disabled={isUpdating}
                          onPress={() => {
                            if (actionInFlightRef.current[item.id]) return;
                            void runCardAction(item.id, rejectAction);
                          }}
                        >
                          <Text style={[styles.cardActionBtnText, styles.cardActionBtnRejectText]}>
                            {isUpdating ? t('status.seller.home.processing') : rejectAction.label}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        activeOpacity={0.86}
                        style={[
                          styles.cardActionBtn,
                          resolvedTone === "preparing"
                            ? styles.cardActionBtnPreparing
                            : resolvedTone === "ready"
                              ? styles.cardActionBtnReady
                              : resolvedTone === "in_delivery"
                                ? styles.cardActionBtnInDelivery
                                : resolvedTone === "approaching"
                                  ? styles.cardActionBtnApproaching
                                  : resolvedTone === "at_door"
                                    ? styles.cardActionBtnDelivered
                                    : resolvedTone === "approve"
                                      ? styles.cardActionBtnApprove
                                      : styles.cardActionBtnCompleted,
                          isDoorStep && styles.cardActionBtnKapidaPulse,
                          isUpdating && styles.cardActionBtnDisabled,
                        ]}
                        disabled={isUpdating || lockDeliveryDecision || (!canRunAction && !isDoorStep && item.status !== "pending_buyer_confirmation")}
                        onPress={() => {
                          if (actionInFlightRef.current[item.id]) return;
                          if (lockDeliveryDecision) return;
                          if (shouldOpenDecisionScreen || item.status === "pending_buyer_confirmation") {
                            onOpenOrder(item.id);
                          } else if (action) {
                            void runCardAction(item.id, action);
                          } else if (isDoorStep) {
                            onOpenOrder(item.id);
                          }
                        }}
                      >
                        <Text style={styles.cardActionBtnText}>
                          {isUpdating
                            ? t('status.seller.home.processing')
                            : lockDeliveryDecision
                              ? t('cta.seller.home.deliveryMetricsLoading')
                            : shouldOpenDecisionScreen
                              ? t('cta.seller.home.reviewDeliveryRequest')
                              : isDoorStep && !action
                                ? t('cta.seller.home.verifyPin')
                                : (action?.label ?? statusText)}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            }}
            ListFooterComponent={onSwitchToBuyer ? (
              <View style={styles.actions}>
                <TouchableOpacity activeOpacity={0.86} style={styles.switchRoleButton} onPress={onSwitchToBuyer}>
                  <Text style={styles.switchRoleButtonText}>{t('cta.seller.home.switchToBuyer')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          />
        )
      ) : (
        <FlatList
          style={styles.ordersScroll}
          data={loading ? [] : activeFoods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.ordersContent, activeFoods.length === 0 && styles.listContentGrow]}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={8}
          removeClippedSubviews={Platform.OS === "android"}
          ListHeaderComponent={loading ? (
            <View style={styles.ordersSection}>
              <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
              <View style={styles.skeletonCard}><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>
            </View>
          ) : null}
          ListEmptyComponent={!loading ? (
            <View style={styles.ordersSection}>
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{t('headline.seller.home.emptyFoodsTitle')}</Text>
                <Text style={styles.emptySub}>{t('helper.seller.home.emptyFoodsSubtitle')}</Text>
              </View>
            </View>
          ) : null}
          renderItem={({ item: food, index }) => (
            <TouchableOpacity
              style={[styles.orderCard, index === activeFoods.length - 1 && styles.orderCardLast]}
              activeOpacity={0.84}
              onPress={() => onOpenFoodsManager(food.id)}
            >
              {(() => {
                const hasStock = food.stock > 0;
                const badgeActiveTone = food.isActive && hasStock;
                const badgeLabel = !food.isActive
                  ? t('status.seller.foodsManager.passive')
                  : (!food.hasAnyLot
                    ? t('status.seller.home.noLot')
                    : (hasStock ? t('status.seller.home.active') : t('status.seller.home.outOfStock')));
                const stockLabel = !food.hasAnyLot
                  ? t('status.seller.home.stockLotMissing')
                  : (hasStock ? formatCopy('status.seller.home.stockLine', { stock: food.stock }) : t('status.seller.home.stockDepleted'));
                return (
                  <>
                    <View style={styles.orderTopRow}>
                      <Text style={styles.orderNo} numberOfLines={1}>{food.name}</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          badgeActiveTone
                            ? { backgroundColor: "#EAF7EE", borderColor: "#B7DEC3" }
                            : { backgroundColor: "#F3ECE5", borderColor: "#DFD1C3" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            { color: badgeActiveTone ? "#166534" : "#7C6A58" },
                          ]}
                        >
                          {badgeLabel}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <Text style={styles.orderTotal}>{Number(food.price).toFixed(2)} TL</Text>
                      <Text style={styles.orderMeta}>{stockLabel}</Text>
                    </View>
                  </>
                );
              })()}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  stickyTop: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: "#F7F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 14,
  },
  title: {
    fontSize: 24,
    color: "#4A3B2F",
    letterSpacing: -0.5,
    marginTop: 4,
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold", fontWeight: "700" }
      : { fontFamily: "sans-serif-condensed", fontWeight: "700" }),
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  ratingStar: {
    fontSize: 15,
    color: "#D4860A",
    lineHeight: 18,
  },
  ratingAvg: {
    fontSize: 14,
    fontWeight: "800",
    color: "#4A3B2F",
  },
  ratingCount: {
    fontSize: 13,
    color: "#7A6B5C",
    fontWeight: "500",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  quickButtonsRow: { flexDirection: "row", gap: 12, marginBottom: 2, alignItems: "stretch" },
  quickButton: {
    flex: 1,
    height: 46,
    backgroundColor: "#F9E9D5",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#79BA94",
    alignItems: "center",
    justifyContent: "center",
  },
  quickButtonText: {
    color: "#1D5634",
    fontSize: 18,
    fontWeight: "800",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold" }
      : { fontFamily: "sans-serif-condensed", includeFontPadding: false }),
  },
  quickWalletButtonText: {
    fontSize: 19,
  },
  quickLpiPill: {
    flex: 1,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#79BA94",
    backgroundColor: "#F9E9D5",
    alignItems: "center",
    justifyContent: "center",
  },
  ordersScroll: { flex: 1 },
  ordersContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  listContentGrow: { flexGrow: 1 },
  ordersSection: { marginBottom: 14 },
  ordersHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingHorizontal: 16 },
  ordersTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ordersTitle: { fontSize: 18, fontWeight: "800", color: "#4A3B2F" },
  ordersCountChip: { alignItems: "center", justifyContent: "center" },
  ordersCountChipText: { color: "#5C4A3A", fontSize: 18, fontWeight: "800" },
  pager: { flex: 1 },
  statBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderBottomWidth: 2,
    borderBottomColor: "#C8BFB3",
    paddingBottom: 4,
  },
  statCount: {
    fontSize: 26,
    fontWeight: "800",
    color: "#3F855C",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold" }
      : { fontFamily: "sans-serif-condensed" }),
  },
  statCountActive: { color: "#1D5634" },
  statLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: "#4A3B2F",
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-DemiBold" }
      : { fontFamily: "sans-serif-condensed" }),
  },
  statLabelActive: { color: "#1D5634" },
  skeletonCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10, gap: 10 },
  skeletonLine: { height: 14, borderRadius: 6, backgroundColor: "#EDE8E0", width: "70%" },
  skeletonLineShort: { height: 12, borderRadius: 6, backgroundColor: "#F2EDE6", width: "40%" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  emptyTitle: { color: "#4A3B2F", fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  groupSection: { marginBottom: 18 },
  groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 2 },
  groupTitle: { color: "#3F3126", fontSize: 16, fontWeight: "800" },
  groupCount: { color: "#6A5A4B", fontSize: 14, fontWeight: "800" },
  groupEmptyCard: { backgroundColor: "#FCFAF7", borderRadius: 10, borderWidth: 1, borderColor: "#ECE3D7", padding: 10, marginBottom: 8 },
  groupEmptyText: { color: "#8A7A6B", fontWeight: "600" },
  orderCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5DDCF", padding: 14, marginBottom: 12, overflow: "hidden" },
  orderCardLast: { marginBottom: 0 },
  kapidaHighlightLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFD166",
  },
  newHighlightLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#8FD9A8",
  },
  orderTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderTitleWrap: { flex: 1, paddingRight: 8 },
  orderTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  orderNo: { color: "#4A3B2F", fontWeight: "800", fontSize: 16, flex: 1 },
  orderTopRight: { alignItems: "flex-end", minWidth: 108 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
  },
  statusBadgeText: { color: "#5C4A3A", fontSize: 11, fontWeight: "700" },
  orderIdText: { color: "#887766", fontSize: 12, fontWeight: "800" },
  orderDateText: { color: "#9A8A7A", fontSize: 11, fontWeight: "700", marginTop: 2 },
  orderBuyerFlowMeta: { color: "#0F766E", fontSize: 12, fontWeight: "800", marginTop: 4 },
  pickupFlowChipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 6 },
  pickupFlowChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#DCCFBF",
    backgroundColor: "#FAF5EC",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pickupFlowChipActive: {
    borderColor: "#8CC6A2",
    backgroundColor: "#EAF7EE",
  },
  pickupFlowChipText: { color: "#75695F", fontSize: 11.5, fontWeight: "700" },
  pickupFlowChipTextActive: { color: "#1F6F43" },
  orderMeta: { color: "#6C6055", marginTop: 3 },
  orderElapsedText: { color: "#7A6C5E", fontSize: 12, fontWeight: "700" },
  deliveryRequestInlineBanner: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CFE4D5",
    backgroundColor: "#F3FAF5",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  deliveryRequestInlineTitle: { color: "#2F6F4A", fontWeight: "800" },
  deliveryRequestInlineMetricText: { color: "#1D5634", marginTop: 4, fontWeight: "800", fontSize: 13 },
  deliveryRequestInlineWarningText: { color: "#A04D00", marginTop: 4, fontWeight: "800" },
  deliveryRequestInlineText: { color: "#456957", marginTop: 2, lineHeight: 18 },
  newBadge: {
    borderRadius: 999,
    backgroundColor: "#157347",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  newBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  orderBottomRow: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderBottomRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  orderTotal: { color: "#4A3B2F", fontWeight: "800" },
  orderThumbSmall: { fontSize: 16, lineHeight: 18 },
  cardActionRow: { marginTop: 14, flexDirection: "row", gap: 8 },
  cardCelebrateEmojiWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -38,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  cardCelebrateEmoji: {
    fontSize: 44,
    lineHeight: 48,
  },
  cardActionBtn: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 13, alignItems: "center" },
  cardActionBtnPreparing: { backgroundColor: "#E2CFBB", borderColor: "#CCAA8B" },
  cardActionBtnReady: { backgroundColor: "#D4E4D6", borderColor: "#ABC8AE" },
  cardActionBtnInDelivery: { backgroundColor: "#D7E0F3", borderColor: "#B0C2DF" },
  cardActionBtnApproaching: { backgroundColor: "#D4E7E8", borderColor: "#A8CBCD" },
  cardActionBtnDelivered: { backgroundColor: "#EBD9CC", borderColor: "#D3B59E" },
  cardActionBtnCompleted: { backgroundColor: "#D5E2DA", borderColor: "#AAC2B1" },
  cardActionBtnKapidaPulse: { borderWidth: 2, borderColor: "#C98E61" },
  cardActionBtnDisabled: { opacity: 0.6 },
  cardActionBtnText: { fontWeight: "800", fontSize: 13, color: "#3F3126" },
  cardActionBtnApprove: { backgroundColor: "#C8E6C9", borderColor: "#81C784" },
  cardActionBtnReject: { backgroundColor: "#FFCDD2", borderColor: "#E57373", flex: 0.7 },
  cardActionBtnRejectText: { color: "#B71C1C" },
  actions: { gap: 12, marginTop: 8 },
  switchRoleButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CFC5B6",
    backgroundColor: "#F7F4EF",
    alignItems: "center",
    justifyContent: "center",
  },
  switchRoleButtonText: {
    color: "#5C4A3A",
    fontSize: 14,
    fontWeight: "700",
  },
});
