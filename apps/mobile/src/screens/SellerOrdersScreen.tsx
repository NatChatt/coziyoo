import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerMeCache } from "../utils/sellerProfileCache";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { formatCopy, t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerOrder = {
  id: string;
  sellerId?: string | null;
  orderNo?: string | null;
  buyerName?: string | null;
  primaryFoodName?: string | null;
  itemCount?: number | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
  updatedAt?: string;
};

type StatusFilter = "all" | "pending_seller_approval" | "awaiting_payment" | "paid" | "preparing" | "ready" | "in_delivery" | "at_door" | "delivered" | "completed" | "cancelled";
const BUSINESS_DAY_RESET_HOUR = 5;
const TURKEY_TIMEZONE = "Europe/Istanbul";

function normalizeSellerOrder(raw: Record<string, unknown>): SellerOrder {
  const id = String(raw.id ?? "");
  return {
    id,
    sellerId: typeof raw.sellerId === "string" ? raw.sellerId : (typeof raw.seller_id === "string" ? raw.seller_id : null),
    orderNo: typeof raw.orderNo === "string" ? raw.orderNo : `#${id.slice(0, 8).toUpperCase()}`,
    buyerName: typeof raw.buyerName === "string" ? raw.buyerName : (typeof raw.buyer_name === "string" ? raw.buyer_name : null),
    primaryFoodName: typeof raw.primaryFoodName === "string" ? raw.primaryFoodName : (typeof raw.primary_food_name === "string" ? raw.primary_food_name : null),
    itemCount: Number(raw.itemCount ?? raw.item_count ?? 0),
    status: String(raw.status ?? ""),
    totalPrice: Number(raw.totalPrice ?? raw.total_price ?? 0),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : (typeof raw.created_at === "string" ? raw.created_at : undefined),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (typeof raw.updated_at === "string" ? raw.updated_at : undefined),
  };
}

function formatOrderDate(iso: string | undefined): string {
  if (!iso) return "-";
  const normalized = iso.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${d.getDate()} ${t(`status.seller.orders.month.${d.getMonth()}` as any)} ${d.getFullYear()} ${h}:${m}`;
}

function parseDateInput(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((x) => Number(x));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

export default function SellerOrdersScreen({ auth, onBack, onOpenOrder, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [sellerCountryCode, setSellerCountryCode] = useState<string>(() => normalizeCountryCode(getSellerMeCache()?.countryCode ?? ""));

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  async function authedFetch(path: string, baseUrl = apiUrl): Promise<Response> {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
    };
    let res = await fetch(`${baseUrl}${path}`, { headers });
    if (res.status !== 401 && res.status !== 403) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function loadOrders() {
    setLoading(true);
    setErrorText(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const primaryRes = await authedFetch("/v1/seller/orders?page=1&pageSize=200", baseUrl);
      const primaryJson = await primaryRes.json();
      if (!primaryRes.ok) throw new Error(primaryJson?.error?.message ?? "Siparişler yüklenemedi");
      let sellerOrders: SellerOrder[] = Array.isArray(primaryJson?.data)
        ? primaryJson.data.map((row: unknown) => normalizeSellerOrder((row ?? {}) as Record<string, unknown>))
        : [];

      // Some environments may return empty for role=seller due to legacy actor filtering.
      // Fallback to unscoped list and extract seller-owned rows client-side.
      if (sellerOrders.length === 0) {
        const fallbackRes = await authedFetch("/v1/orders?page=1&pageSize=200&role=seller", baseUrl);
        const fallbackJson = await fallbackRes.json();
        if (fallbackRes.ok && Array.isArray(fallbackJson?.data)) {
          const normalizedFallback = (fallbackJson.data as unknown[]).map((row: unknown) => normalizeSellerOrder((row ?? {}) as Record<string, unknown>));
          const fromAll = normalizedFallback.filter((row) => row.sellerId === currentAuth.userId);
          sellerOrders = fromAll.length > 0 ? fromAll : normalizedFallback;
        }
      }

      const meRes = await authedFetch("/v1/auth/me", baseUrl);
      if (meRes.ok) {
        const meJson = await meRes.json().catch(() => ({}));
        const cc = normalizeCountryCode(meJson?.data?.countryCode ?? "");
        if (cc) setSellerCountryCode(cc);
      }

      setOrders(sellerOrders);
    } catch (e) {
      const message = e instanceof Error ? e.message : t('error.seller.orders.load');
      setErrorText(message);
      Alert.alert(t('headline.common.error'), message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const filteredOrders = useMemo(() => {
    const now = new Date(clockMs);
    const useTurkeyTime = sellerCountryCode === "TR";
    const from = parseDateInput(fromDate);
    const to = parseDateInput(toDate);
    const toEnd = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) : null;

    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      const receivedAt = parseApiDate(order.createdAt) ?? parseApiDate(order.updatedAt);
      if (!receivedAt) return false;
      // Aynı iş günündeki siparişler ana sayfadaki "Bugünkü Siparişler" bölümünde kalır.
      if (isCurrentBusinessDay(receivedAt, now, useTurkeyTime)) return false;
      if (!from && !toEnd) return true;
      if (from && receivedAt < from) return false;
      if (toEnd && receivedAt > toEnd) return false;
      return true;
    });
  }, [orders, statusFilter, fromDate, toDate, clockMs, sellerCountryCode]);

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('headline.seller.orders.title')} onBack={onBack} />
      <View style={styles.filtersCard}>
        <Text style={styles.filtersTitle}>{t('headline.seller.orders.filters')}</Text>
        <View style={styles.filterRow}>
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder={t('helper.seller.orders.fromDate')}
            placeholderTextColor="#9A8C82"
            style={styles.dateInput}
          />
          <TextInput
            value={toDate}
            onChangeText={setToDate}
            placeholder={t('helper.seller.orders.toDate')}
            placeholderTextColor="#9A8C82"
            style={styles.dateInput}
          />
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          {filteredOrders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>{t('headline.seller.orders.emptyTitle')}</Text>
              <Text style={styles.emptySub}>
                {errorText
                  ? t('helper.seller.orders.emptyErrorSubtitle')
                  : t('helper.seller.orders.emptySubtitle')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredOrders}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => onOpenOrder(item.id)}>
                  {item.primaryFoodName ? (
                    <View style={styles.cardHeader}>
                      <Text style={styles.foodName}>
                        {item.primaryFoodName}{item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                      </Text>
                      <Text style={styles.orderNo}>{item.orderNo || "#" + item.id.slice(0, 8).toUpperCase()}</Text>
                    </View>
                  ) : (
                    <View style={styles.cardHeader}>
                      <Text style={styles.orderNo}>{item.orderNo || "#" + item.id.slice(0, 8).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.meta}>{formatCopy('status.seller.orders.buyer', { name: item.buyerName || "-" })}</Text>
                  {(item.updatedAt || item.createdAt) ? (
                    <Text style={styles.meta}>{formatOrderDate(item.updatedAt ?? item.createdAt)}</Text>
                  ) : null}
                  <Text style={styles.total}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  filtersCard: {
    marginHorizontal: 14,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 10,
    gap: 8,
  },
  filtersTitle: { color: "#2E241C", fontWeight: "800", fontSize: 14 },
  filterRow: { flexDirection: "row", gap: 8 },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E0D6C9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: "#2E241C",
    backgroundColor: "#FCFAF7",
    fontSize: 13,
    fontWeight: "500",
  },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderNo: { color: "#6C6055", fontWeight: "800", fontSize: 13 },
  foodName: { color: "#2E241C", fontWeight: "700", fontSize: 14, flex: 1, marginRight: 8 },
  meta: { color: "#6C6055", marginTop: 3 },
  total: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  emptyWrap: {
    marginHorizontal: 14,
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 14,
  },
  emptyTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  emptySub: { color: "#6C6055", marginTop: 4, lineHeight: 20 },
});
