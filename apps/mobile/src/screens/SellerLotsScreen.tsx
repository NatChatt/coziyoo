import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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

export default function SellerLotsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [lots, setLots] = useState<SellerLot[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [quantity, setQuantity] = useState("10");

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
        authedFetch("/v1/seller/lots", undefined, baseUrl),
      ]);
      const foodsJson = await foodsRes.json();
      const lotsJson = await lotsRes.json();
      if (!foodsRes.ok) throw new Error(foodsJson?.error?.message ?? t('error.seller.lots.foodsLoad'));
      if (!lotsRes.ok) throw new Error(lotsJson?.error?.message ?? t('error.seller.lots.load'));
      const rows = Array.isArray(foodsJson?.data) ? foodsJson.data : [];
      setFoods(rows.map((row: any) => ({ id: row.id, name: row.name })));
      setLots(Array.isArray(lotsJson?.data) ? lotsJson.data : []);
      if (!selectedFoodId && rows[0]?.id) setSelectedFoodId(rows[0].id);
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

  async function createLot() {
    if (!selectedFoodId) {
      Alert.alert(t('headline.common.error'), t('error.seller.lots.selectFood'));
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert(t('headline.common.error'), t('error.seller.lots.validQuantity'));
      return;
    }
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    try {
      const res = await authedFetch("/v1/seller/lots", {
        method: "POST",
        body: JSON.stringify({
          foodId: selectedFoodId,
          producedAt: now.toISOString(),
          saleStartsAt: now.toISOString(),
          saleEndsAt: end.toISOString(),
          quantityProduced: qty,
          quantityAvailable: qty,
          notes: t('helper.seller.lots.note'),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t('error.seller.lots.open'));
      setModalVisible(false);
      await loadData();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.lots.open'));
    }
  }

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
          <TouchableOpacity onPress={() => setModalVisible(true)}>
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

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{t('headline.seller.lots.quickCreate')}</Text>
          <Text style={styles.label}>{t('helper.seller.lots.food')}</Text>
          {foods.map((food) => (
            <TouchableOpacity
              key={food.id}
              style={[styles.foodPick, selectedFoodId === food.id && styles.foodPickActive]}
              onPress={() => setSelectedFoodId(food.id)}
            >
              <Text>{food.name}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.label}>{t('helper.seller.lots.quantity')}</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          <TouchableOpacity style={styles.saveBtn} onPress={() => void createLot()}><Text style={styles.saveText}>{t('cta.seller.lots.open')}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text>{t('cta.common.cancel')}</Text></TouchableOpacity>
        </View>
      </Modal>
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
  modal: { flex: 1, backgroundColor: "#F7F4EF", padding: 16 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginBottom: 10 },
  label: { fontWeight: "700", color: "#2E241C", marginTop: 8, marginBottom: 6 },
  foodPick: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#E2D9CA", backgroundColor: "#fff", marginBottom: 6 },
  foodPickActive: { borderColor: "#3F855C", backgroundColor: "#EAF4ED" },
  input: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 12, paddingVertical: 10 },
  saveBtn: { marginTop: 12, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
  cancelBtn: { marginTop: 8, backgroundColor: "#EFE7DA", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
});
