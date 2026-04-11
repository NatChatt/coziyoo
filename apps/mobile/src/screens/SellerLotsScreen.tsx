import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { formatCopy, t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenLotCreate?: () => void;
  filterFoodId?: string;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = { id: string; name: string };
type SellerLot = {
  id: string;
  food_id: string;
  lot_number: string;
  quantity_available: number;
  quantity_produced: number;
  sale_ends_at: string;
  lifecycle_status: string;
};

export default function SellerLotsScreen({ auth, onBack, onOpenLotCreate, filterFoodId, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [lots, setLots] = useState<SellerLot[]>([]);
  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401) return res;
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

  async function loadData() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const [foodsRes, lotsRes] = await Promise.all([
        authedFetch("/v1/seller/foods", undefined, baseUrl),
        authedFetch(`/v1/seller/lots${filterFoodId ? `?foodId=${encodeURIComponent(filterFoodId)}` : ''}`, undefined, baseUrl),
      ]);
      const foodsJson = await foodsRes.json();
      const lotsJson = await lotsRes.json();
      if (!foodsRes.ok) throw new Error(foodsJson?.error?.message ?? t('error.seller.lots.foodsLoad'));
      if (!lotsRes.ok) throw new Error(lotsJson?.error?.message ?? t('error.seller.lots.load'));
      const rows = Array.isArray(foodsJson?.data) ? foodsJson.data : [];
      setFoods(rows.map((row: any) => ({ id: row.id, name: row.name })));
      setLots(Array.isArray(lotsJson?.data) ? lotsJson.data : []);
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.lots.load'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const foodNameById = useMemo(() => {
    const map = new Map<string, string>();
    foods.forEach((food) => map.set(food.id, food.name));
    return map;
  }, [foods]);

  async function recallLot(lotId: string) {
    try {
      const res = await authedFetch(`/v1/seller/lots/${lotId}/recall`, {
        method: "POST",
        body: JSON.stringify({ reason: "Mobil panel recall" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t('error.seller.lots.recall'));
      await loadData();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.lots.recall'));
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={t('headline.seller.lots.title')}
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={() => onOpenLotCreate?.()}>
            <Text style={styles.add}>{t('cta.seller.lots.add')}</Text>
          </TouchableOpacity>
        }
      />
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <FlatList
          data={lots}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 14, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.lotTitle}>{foodNameById.get(item.food_id) ?? item.food_id}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.lots.lotNo', { value: item.lot_number })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.lots.stock', { available: item.quantity_available, produced: item.quantity_produced })}</Text>
              <Text style={styles.meta}>{formatCopy('status.seller.lots.status', { status: item.lifecycle_status })}</Text>
              <TouchableOpacity style={styles.recallBtn} onPress={() => void recallLot(item.id)}>
                <Text style={styles.recallText}>{t('cta.seller.lots.recall')}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  add: { color: "#3F855C", fontWeight: "700", fontSize: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  lotTitle: { fontSize: 16, fontWeight: "800", color: "#2E241C" },
  meta: { color: "#6B5F54", marginTop: 4 },
  recallBtn: { marginTop: 8, alignSelf: "flex-start", backgroundColor: "#FCEAEA", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  recallText: { color: "#B42318", fontWeight: "700" },
});
