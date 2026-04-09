import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerFoodsCache, setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { normalizeSellerLotSnapshot, summarizeSellerLotsByFood } from "../utils/sellerLotSummary";
import { theme } from "../theme/colors";
import { formatCopy, t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenFoodsForm: (mode: "add" | "edit", foodId?: string, food?: SellerFood) => void;
  onOpenLotCreate?: (foodId: string) => void;
  onOpenLots?: (foodId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  name: string;
  cardSummary?: string | null;
  price: number;
  isActive: boolean;
  stock?: number;
  hasAnyLot?: boolean;
  [key: string]: unknown;
};

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "t", "yes", "y", "aktif", "active"].includes(normalized);
  }
  return false;
}

export default function SellerFoodsManagerScreen({ auth, onBack, onOpenFoodsForm, onOpenLotCreate, onOpenLots, onAuthRefresh }: Props) {
  const initialCache = getSellerFoodsCache() as SellerFood[] | null;
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [foods, setFoods] = useState<SellerFood[]>(initialCache ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
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

  async function loadFoods(options?: { silent?: boolean }) {
    if (!options?.silent || foods.length === 0) setLoading(true);
    try {
      const settings = await loadSettings();
      setApiUrl(settings.apiUrl);
      const [foodsRes, lotsRes] = await Promise.all([
        authedFetch("/v1/seller/foods", undefined, settings.apiUrl),
        authedFetch("/v1/seller/lots", undefined, settings.apiUrl),
      ]);
      const json = await foodsRes.json();
      const lotsJson = await lotsRes.json().catch(() => ({}));
      if (!foodsRes.ok) {
        console.warn("[seller-foods-manager] foods fetch failed", {
          status: foodsRes.status,
          message: json?.error?.message ?? null,
          userId: currentAuth.userId,
          actorRole: "seller",
        });
        throw new Error(json?.error?.message ?? t('error.seller.foodsManager.load'));
      }
      const lotSummaries = lotsRes.ok && Array.isArray(lotsJson?.data)
        ? summarizeSellerLotsByFood((lotsJson.data as Record<string, unknown>[]).map((item) => normalizeSellerLotSnapshot(item)))
        : new Map<string, { hasAnyLot: boolean; stock: number }>();
      const list: SellerFood[] = Array.isArray(json?.data) ? json.data.map((item: any) => ({
        ...item,
        id: String(item.id),
        name: String(item.name ?? ""),
        cardSummary: typeof item.cardSummary === "string" ? item.cardSummary : null,
        price: Number(item.price ?? 0),
        isActive: toBool(item.isActive ?? item.is_active),
        stock: lotSummaries.get(String(item.id))?.stock ?? Number(item.stock ?? 0),
        hasAnyLot: lotSummaries.get(String(item.id))?.hasAnyLot ?? Boolean(item.hasAnyLot ?? item.has_any_lot),
      })) : [];
      console.info("[seller-foods-manager] foods loaded", {
        count: list.length,
        userId: currentAuth.userId,
      });
      setFoods(list);
      setSellerFoodsCache(list as unknown as Record<string, unknown>[]);
    } catch (e) {
      const cache = getSellerFoodsCache();
      if (!cache || cache.length === 0) {
        Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foodsManager.load'));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cache = getSellerFoodsCache();
    void loadFoods({ silent: Boolean(cache && cache.length > 0) });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <Text style={styles.pageTitle}>{t('headline.seller.foodsManager.title')}</Text>
          <TouchableOpacity style={styles.addBtn} activeOpacity={0.85} onPress={() => onOpenFoodsForm("add")}>
            <Text style={styles.addBtnText}>{t('cta.seller.foodsManager.addFood')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={foods}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          loading && foods.length > 0 ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color="#3F855C" />
              <Text style={styles.inlineLoadingText}>{t('status.seller.foodsManager.loading')}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={() => onOpenLots?.(item.id)}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.badge, item.isActive ? styles.badgeActive : styles.badgePassive]}>
                {item.isActive ? t('status.seller.foodsManager.active') : t('status.seller.foodsManager.passive')}
              </Text>
            </View>
            <Text style={styles.summary}>{item.cardSummary || t('helper.seller.foodsManager.summaryMissing')}</Text>
            <View style={styles.rowBottom}>
              <Text style={styles.price}>{item.price.toFixed(2)} TL</Text>
              <Text style={styles.stock}>
                {item.hasAnyLot
                  ? formatCopy('status.seller.foodsManager.stock', { stock: item.stock ?? 0 })
                  : t('status.seller.foodsManager.stockLotMissing')}
              </Text>
            </View>
            <View style={styles.cardFooter}>
              <TouchableOpacity
                style={styles.editChip}
                activeOpacity={0.8}
                onPress={(e) => { e.stopPropagation?.(); onOpenFoodsForm("edit", item.id, item); }}
              >
                <Text style={styles.editChipText}>{t('cta.seller.foodsManager.editFood')}</Text>
              </TouchableOpacity>
              {onOpenLotCreate ? (
                <TouchableOpacity
                  style={styles.lotCreateBtn}
                  activeOpacity={0.8}
                  onPress={(e) => { e.stopPropagation?.(); onOpenLotCreate(item.id); }}
                >
                  <Text style={styles.lotCreateBtnText}>{t('cta.seller.foodsManager.createLot')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('status.seller.foodsManager.loading')}</Text>
              <Text style={styles.emptySub}>{t('helper.seller.foodsManager.loadingSubtitle')}</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('headline.seller.foodsManager.emptyTitle')}</Text>
              <Text style={styles.emptySub}>{t('helper.seller.foodsManager.emptySubtitle')}</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  headerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
    backgroundColor: "#F7F4EF",
    position: "relative",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    top: Platform.OS === "ios" ? 56 : 16,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  addBtn: {
    height: 36,
    borderRadius: 999,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 19 },
  pageTitle: {
    color: "#2E241C",
    fontWeight: "900",
    fontSize: 20,
    marginTop: 0,
    marginBottom: 0,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  inlineLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  inlineLoadingText: { color: "#6C6055", fontWeight: "600" },
  listContent: { padding: 14, gap: 10, paddingBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: "#2E241C", fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: "700", overflow: "hidden" },
  badgeActive: { color: "#2F6D49", backgroundColor: "#EAF4EE" },
  badgePassive: { color: "#7C6A58", backgroundColor: "#F3ECE5" },
  summary: { color: "#6C6055", fontSize: 13 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  price: { color: "#2E241C", fontWeight: "800" },
  stock: { color: "#6C6055", fontWeight: "600" },
  editChip: { backgroundColor: "#F3ECE5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#D9C8B4" },
  editChipText: { color: "#6C6055", fontWeight: "700", fontSize: 13 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  lotCreateBtn: { backgroundColor: "#EAF4ED", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#79BA94" },
  lotCreateBtnText: { color: "#1D5634", fontWeight: "700", fontSize: 13 },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 14 },
  emptyTitle: { color: "#2E241C", fontSize: 16, fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
});
