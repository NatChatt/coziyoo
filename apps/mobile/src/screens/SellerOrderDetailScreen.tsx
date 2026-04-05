import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import StatusBadge from "../components/StatusBadge";
import { subscribeOrderRealtime } from "../utils/realtime";
import { t } from "../copy/brandCopy";

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function formatOrderDate(iso: string | undefined): string {
  if (!iso) return "-";
  const normalized = iso.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${h}:${m}`;
}

type OrderDetail = {
  id: string;
  orderNo?: string;
  status: string;
  requestedDeliveryType?: 'pickup' | 'delivery' | string;
  activeDeliveryType?: 'pickup' | 'delivery' | string;
  sellerDecisionState?: 'pending' | 'revised' | 'approved' | 'rejected' | string;
  sellerEtaMinutes?: number | null;
  sellerPromisedAt?: string | null;
  sellerDeliveryNote?: string | null;
  sellerDeliveryTermsSnapshot?: string | null;
  approvedAt?: string | null;
  paymentCapturedAt?: string | null;
  createdAt?: string;
  buyerName?: string;
  deliveryType?: string;
  totalPrice: number;
  items?: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal?: number;
    selectedAddons?: {
      free?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer" }>;
      paid?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer"; price: number; quantity?: number }>;
    };
  }>;
  deliveryAddress?: {
    title?: string;
    addressLine?: string;
    line?: string;
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
  } | null;
  sellerAddress?: {
    title?: string;
    addressLine?: string;
    line?: string;
    lat?: number | string;
    lng?: number | string;
    latitude?: number | string;
    longitude?: number | string;
  } | null;
};

type MapCoordinates = { lat: number; lng: number };

async function openAddressInMaps(address: string): Promise<void> {
  const query = address.trim();
  if (!query) return;
  const encoded = encodeURIComponent(query);
  const appleDirectionsUrl = `http://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  const googleNavUrl = `google.navigation:q=${encoded}&mode=d`;
  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  const candidates = Platform.OS === "ios"
    ? [appleDirectionsUrl]
    : [googleNavUrl, googleDirectionsUrl];
  for (const url of candidates) {
    const supported = await Linking.canOpenURL(url);
    if (!supported) continue;
    await Linking.openURL(url);
    return;
  }
  throw new Error("Harita uygulaması açılamadı");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractAddressCoordinates(value: unknown): MapCoordinates | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lat = toFiniteNumber(row.lat ?? row.latitude);
  const lng = toFiniteNumber(row.lng ?? row.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function openAddressInMapsWithCoordinates(
  address: string | null | undefined,
  coordinates: MapCoordinates | null,
): Promise<void> {
  const fallbackAddress = String(address ?? "").trim();
  if (coordinates) {
    return openAddressInMaps(`${coordinates.lat},${coordinates.lng}`);
  }
  return openAddressInMaps(fallbackAddress);
}

function normalizeFlowStatus(status: string): string {
  if (status === "completed") return "delivered";
  return status;
}

function getNextAction(status: string, deliveryType?: string): { label: string; toStatus: string } | null {
  const normalized = normalizeFlowStatus(status);
  const pickup = deliveryType === "pickup";
  if (normalized === "paid") {
    return { label: "Hazırlıyorum", toStatus: "preparing" };
  }
  if (normalized === "preparing") {
    return { label: "Hazırlandı", toStatus: "ready" };
  }
  // Pickup: seller owns seller flow and can update in parallel with buyer flow.
  if (pickup) {
    if (normalized === "ready") return { label: "Yoldayım", toStatus: "in_delivery" };
    if (normalized === "in_delivery") return { label: "Yaklaştım", toStatus: "approaching" };
    if (normalized === "approaching") return { label: "Kapıdayım", toStatus: "at_door" };
    if (normalized === "at_door") return { label: "Teslim Edildi", toStatus: "completed" };
    return null;
  }
  // Delivery flow
  if (normalized === "ready") {
    return { label: "Yola Çıktı", toStatus: "in_delivery" };
  }
  if (normalized === "in_delivery") return { label: "Yaklaştı", toStatus: "approaching" };
  if (normalized === "approaching") return { label: "Kapıda", toStatus: "at_door" };
  if (normalized === "at_door") return { label: "Teslim Edildi", toStatus: "delivered" };
  return null;
}

function actionTone(toStatus: string): { bg: string; border: string } {
  if (toStatus === "preparing") return { bg: "#B86A00", border: "#B86A00" };
  if (toStatus === "ready") return { bg: "#166534", border: "#166534" };
  if (toStatus === "in_delivery") return { bg: "#1D4ED8", border: "#1D4ED8" };
  if (toStatus === "approaching") return { bg: "#0F766E", border: "#0F766E" };
  if (toStatus === "at_door") return { bg: "#0F766E", border: "#0F766E" };
  if (toStatus === "delivered" || toStatus === "completed") return { bg: "#166534", border: "#166534" };
  return { bg: "#3F855C", border: "#3F855C" };
}

export default function SellerOrderDetailScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [pinCode, setPinCode] = useState("");
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [decisionDeliveryType, setDecisionDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [decisionEtaMinutes, setDecisionEtaMinutes] = useState("30");
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401 && res.status !== 403) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function loadOrder() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch(`/v1/orders/${orderId}`, undefined, baseUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Sipariş detay yüklenemedi");
      setOrder(json?.data ?? null);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Sipariş detay yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrder();
  }, [orderId]);

  async function refreshOrderStatus() {
    try {
      const res = await authedFetch(`/v1/orders/${orderId}`);
      const json = await res.json();
      if (res.ok) setOrder(json?.data ?? null);
    } catch {
      // silent refresh — don't alert
    }
  }

  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    if (!order) return;
    const terminal = ["completed", "cancelled", "rejected"].includes(order.status);
    if (terminal) return;
    statusPollRef.current = setInterval(() => { void refreshOrderStatus(); }, 8_000);
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    };
  }, [order?.status]);

  useEffect(() => {
    if (!order?.id) return () => {};
    return subscribeOrderRealtime(order.id, () => { void refreshOrderStatus(); });
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    setDecisionDeliveryType(
      order.activeDeliveryType === "delivery" || order.requestedDeliveryType === "delivery"
        ? "delivery"
        : "pickup"
    );
    setDecisionEtaMinutes(order.sellerEtaMinutes ? String(order.sellerEtaMinutes) : "30");
    setDecisionNote(order.sellerDeliveryNote?.trim() ?? "");
    setDecisionReason("");
  }, [order?.id, order?.activeDeliveryType, order?.requestedDeliveryType, order?.sellerEtaMinutes, order?.sellerDeliveryNote]);

  useEffect(() => {
    const handleShow = (event: { endCoordinates?: { height?: number } }) => {
      setKeyboardInset(event?.endCoordinates?.height ?? 0);
    };
    const handleHide = () => setKeyboardInset(0);
    const willShowSub = Keyboard.addListener("keyboardWillShow", handleShow);
    const didShowSub = Keyboard.addListener("keyboardDidShow", handleShow);
    const willHideSub = Keyboard.addListener("keyboardWillHide", handleHide);
    const didHideSub = Keyboard.addListener("keyboardDidHide", handleHide);
    return () => {
      willShowSub.remove();
      didShowSub.remove();
      willHideSub.remove();
      didHideSub.remove();
    };
  }, []);

  const action = useMemo(() => {
    if (!order) return null;
    return getNextAction(order.status, order.deliveryType);
  }, [order?.status, order?.deliveryType]);
  const isDecisionStage = Boolean(order && normalizeFlowStatus(order.status) === "pending_seller_approval");
  const actionColors = action ? actionTone(action.toStatus) : null;
  const shouldCheckPinBeforeComplete = useMemo(
    () =>
      Boolean(
        order &&
          action &&
          ((order.deliveryType === "delivery" && action.toStatus === "delivered") ||
            (order.deliveryType === "pickup" && action.toStatus === "completed")) &&
          normalizeFlowStatus(order.status) === "at_door"
      ),
    [order, action]
  );

  useEffect(() => {
    if (!shouldCheckPinBeforeComplete || keyboardInset <= 0) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(timer);
  }, [shouldCheckPinBeforeComplete, keyboardInset]);
  const isPinReady = pinCode.trim().length >= 4 && pinCode.trim().length <= 8;
  const deliveryAddressText = useMemo(() => {
    if (!order) return "";
    return [order.deliveryAddress?.title, order.deliveryAddress?.addressLine || order.deliveryAddress?.line].filter(Boolean).join(" · ");
  }, [order]);
  const mapAddressText = deliveryAddressText;
  const mapCoordinates = useMemo(() => {
    if (!order) return null;
    return extractAddressCoordinates(order.deliveryAddress);
  }, [order]);
  const deliveryFee = useMemo(() => {
    if (!order || order.deliveryType !== "delivery") return 0;
    const itemsSubtotal = (order.items ?? []).reduce((sum, item) => {
      const explicitLineTotal = Number(item.lineTotal ?? 0);
      if (explicitLineTotal > 0) return sum + explicitLineTotal;
      const base = Number(item.unitPrice ?? 0) * Number(item.quantity ?? 0);
      const addons = (item.selectedAddons?.paid ?? []).reduce(
        (addonSum, addon) => addonSum + (Number(addon.price ?? 0) * Number(addon.quantity ?? 1)),
        0,
      );
      return sum + base + addons;
    }, 0);
    return Math.max(0, Number((Number(order.totalPrice ?? 0) - itemsSubtotal).toFixed(2)));
  }, [order]);
  const sellerStatusBadgeKey = useMemo(() => {
    if (!order) return "";
    const normalized = normalizeFlowStatus(order.status);
    if (order.deliveryType === "pickup" && normalized === "ready") {
      return "pickup_ready_seller";
    }
    return normalized;
  }, [order]);
  const buyerRequestedDelivery = useMemo(
    () => Boolean(
      order &&
      order.requestedDeliveryType === "delivery" &&
      order.activeDeliveryType !== "delivery"
    ),
    [order]
  );

  useEffect(() => {
    if (!shouldCheckPinBeforeComplete) {
      setPinCode("");
      setPinModalVisible(false);
    }
  }, [shouldCheckPinBeforeComplete]);

  async function submitSellerDecision(decision: "approve" | "revise" | "reject") {
    if (!order) return;
    setUpdating(true);
    try {
      const etaMinutes = Number(decisionEtaMinutes);
      const body: Record<string, unknown> = { decision };
      if (decision === "reject") {
        body.reason = decisionReason.trim();
      } else {
        body.deliveryType = decisionDeliveryType;
        body.etaMinutes = etaMinutes;
        body.note = decisionNote.trim();
      }

      const res = await authedFetch(`/v1/orders/${order.id}/seller-decision`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "Karar kaydedilemedi");
      await loadOrder();
      Alert.alert(
        "Tamam",
        decision === "approve"
          ? "Sipariş onaylandı, ödeme otomatik alındı."
          : decision === "revise"
            ? "Sipariş planı güncellendi."
            : "Sipariş iptal edildi.",
      );
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Karar kaydedilemedi");
    } finally {
      setUpdating(false);
    }
  }

  async function runAction(action: { label: string; toStatus: string }): Promise<boolean> {
    if (!order) return false;
    setUpdating(true);
    try {
      const changeStatus = async (toStatus: string) => {
        const res = await authedFetch(`/v1/orders/${order.id}/status`, {
          method: "POST",
          body: JSON.stringify({ toStatus }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Durum güncellenemedi");
      };
      const verifyPin = async (pin: string) => {
        const res = await authedFetch(`/v1/orders/${order.id}/delivery-proof/pin/verify`, {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? "PIN doğrulanamadı");
      };

      try {
        if (shouldCheckPinBeforeComplete) {
          const pin = pinCode.trim();
          if (!/^\d{4,8}$/.test(pin)) throw new Error("4-8 haneli kod gir.");
          await verifyPin(pin);
          if (order.deliveryType === "delivery") {
            await changeStatus("delivered");
            await changeStatus("completed");
          }
        } else {
          await changeStatus(action.toStatus);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("Cannot transition")) {
          await loadOrder();
          throw new Error("Durum güncellendi, sıradaki adımı tekrar onayla.");
        }
        if (message.includes("PIN")) {
          throw new Error("Kod doğrulanamadı. Kodu kontrol et.");
        }
        throw error;
      }
      await loadOrder();
      return true;
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Durum güncellenemedi");
      return false;
    } finally {
      setUpdating(false);
    }
  }

  async function handlePinVerifyFromModal() {
    if (!action || !shouldCheckPinBeforeComplete) return;
    const ok = await runAction(action);
    if (!ok) return;
    setPinModalVisible(false);
    setPinCode("");
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Sipariş Detayı" onBack={onBack} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          (action || isDecisionStage) ? styles.contentWithStickyAction : null,
          keyboardInset > 0
            ? { paddingBottom: 36 + keyboardInset + (shouldCheckPinBeforeComplete ? 96 : 0) }
            : null,
        ]}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
      {loading || !order ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderNo}>{order.orderNo || "#" + order.id.slice(0, 8).toUpperCase()}</Text>
              <StatusBadge
                status={sellerStatusBadgeKey}
                size="sm"
                deliveryType={order.deliveryType === "pickup" ? undefined : order.deliveryType}
              />
            </View>
            <Text style={styles.meta}>Alıcı: {order.buyerName || "-"}</Text>
            <Text style={styles.meta}>Sipariş Türü: {order.deliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
            {buyerRequestedDelivery ? (
              <View style={styles.deliveryRequestBanner}>
                <Text style={styles.deliveryRequestTitle}>{t('helper.seller.orderDetail.deliveryRequestTitle')}</Text>
                <Text style={styles.deliveryRequestText}>{t('helper.seller.orderDetail.deliveryRequestBody')}</Text>
              </View>
            ) : null}
            {order.createdAt ? <Text style={styles.meta}>Tarih: {formatOrderDate(order.createdAt)}</Text> : null}
            {order.deliveryType === "delivery" ? (
              <Text style={styles.meta}>Teslimat Ücreti: {deliveryFee.toFixed(2)} TL</Text>
            ) : null}
          </View>
          {order.deliveryType === "delivery" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Teslimat Adresi</Text>
              <TouchableOpacity
                activeOpacity={mapAddressText ? 0.78 : 1}
                disabled={!mapAddressText}
                onPress={() => {
                  if (!mapAddressText) return;
                  openAddressInMapsWithCoordinates(mapAddressText, mapCoordinates).catch((error) => {
                    Alert.alert("Hata", error instanceof Error ? error.message : "Harita açılamadı");
                  });
                }}
              >
                <Text style={[styles.meta, mapAddressText ? styles.linkText : null]}>{order.deliveryAddress?.title || "-"}</Text>
                <Text style={[styles.meta, mapAddressText ? styles.linkText : null]}>{order.deliveryAddress?.addressLine || order.deliveryAddress?.line || "-"}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {isDecisionStage ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Sipariş Kararı</Text>
              <Text style={styles.meta}>
                {buyerRequestedDelivery
                  ? t('helper.seller.orderDetail.deliveryRequestBody')
                  : "Bu sipariş varsayılan olarak Gel Al başladı. İstersen teslimata çevirip şartlarını belirleyebilirsin."}
              </Text>

              <Text style={styles.inlineFieldLabel}>Teslimat tipi</Text>
              <View style={styles.choiceRow}>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "pickup" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("pickup")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "pickup" && styles.choiceChipTextActive]}>
                    {buyerRequestedDelivery ? t('cta.seller.orderDetail.keepPickup') : "Gel Al"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "delivery" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("delivery")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "delivery" && styles.choiceChipTextActive]}>
                    {buyerRequestedDelivery ? t('cta.seller.orderDetail.canDeliver') : "Teslimat"}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inlineFieldLabel}>
                {decisionDeliveryType === "delivery" ? "Tahmini varış (dk)" : "Hazır olma süresi (dk)"}
              </Text>
              <TextInput
                style={styles.pinInput}
                value={decisionEtaMinutes}
                onChangeText={(value) => setDecisionEtaMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                placeholder="Örn: 30"
                placeholderTextColor="#9C8E81"
              />

              <Text style={styles.inlineFieldLabel}>
                {decisionDeliveryType === "delivery" ? "Sipariş notu" : "Gel al notu"}
              </Text>
              <TextInput
                style={[styles.pinInput, styles.noteInput]}
                value={decisionNote}
                onChangeText={setDecisionNote}
                multiline
                placeholder={decisionDeliveryType === "delivery" ? "Örn: Apartman kapısında teslim ederim." : "Örn: 30 dakikaya hazır olur."}
                placeholderTextColor="#9C8E81"
              />

              <Text style={styles.inlineFieldLabel}>İptal sebebi</Text>
              <TextInput
                style={[styles.pinInput, styles.noteInput]}
                value={decisionReason}
                onChangeText={setDecisionReason}
                multiline
                placeholder="İptal edeceksen sebebi yaz."
                placeholderTextColor="#9C8E81"
              />

              <View style={styles.decisionActions}>
                <TouchableOpacity
                  style={[styles.secondaryActionBtn, updating && styles.actionDisabled]}
                  disabled={updating}
                  onPress={() => { void submitSellerDecision("revise"); }}
                >
                  <Text style={styles.secondaryActionText}>Revize Et</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectActionBtn, updating && styles.actionDisabled]}
                  disabled={updating}
                  onPress={() => { void submitSellerDecision("reject"); }}
                >
                  <Text style={styles.rejectActionText}>İptal Et</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ürünler</Text>
            {(order.items ?? []).map((item, index) => (
              <View key={`${item.id || item.name}-${index}`} style={styles.itemRowWrap}>
                {(() => {
                  const mainItemTotal = Number(item.unitPrice ?? 0) * Number(item.quantity ?? 0);
                  return (
                    <Text style={styles.meta}>
                      {item.name} x{item.quantity} = {mainItemTotal.toFixed(2)} TL
                    </Text>
                  );
                })()}
                {(item.selectedAddons?.free?.length ?? 0) > 0 ? (
                  <Text style={styles.addonMeta}>
                    Ücretsiz: {(item.selectedAddons?.free ?? []).map((addon) => addon.name).join(", ")}
                  </Text>
                ) : null}
                {(item.selectedAddons?.paid?.length ?? 0) > 0
                  ? (item.selectedAddons?.paid ?? []).map((addon, addonIndex) => {
                      const qty = Number.isInteger(addon.quantity) && Number(addon.quantity) > 0 ? Number(addon.quantity) : 1;
                      const subtotal = Number(addon.price ?? 0) * qty;
                      return (
                        <Text key={`${item.id || item.name}-${index}-paid-${addon.name}-${addonIndex}`} style={styles.addonMeta}>
                          • {addon.name} x{qty} (+{subtotal.toFixed(2)} TL)
                        </Text>
                      );
                    })
                  : null}
              </View>
            ))}
            <View style={styles.productsTotalRow}>
              <Text style={styles.productsTotalLabel}>Toplam</Text>
              <Text style={styles.productsTotalValue}>{Number(order.totalPrice ?? 0).toFixed(2)} TL</Text>
            </View>
          </View>
          {(order.sellerPromisedAt || order.sellerDeliveryNote || order.sellerDeliveryTermsSnapshot) ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Aktif Plan</Text>
              <Text style={styles.meta}>Tip: {order.activeDeliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
              {order.sellerPromisedAt ? <Text style={styles.meta}>Hedef zaman: {formatOrderDate(order.sellerPromisedAt)}</Text> : null}
              {order.sellerDeliveryNote ? <Text style={styles.meta}>Sipariş notu: {order.sellerDeliveryNote}</Text> : null}
              {order.sellerDeliveryTermsSnapshot ? <Text style={styles.meta}>Genel koşul: {order.sellerDeliveryTermsSnapshot}</Text> : null}
            </View>
          ) : null}

          {action ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Aksiyonlar</Text>
              {shouldCheckPinBeforeComplete ? (
                <Text style={styles.meta}>Alıcıdan kodu alıp doğrula.</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      </ScrollView>

      {isDecisionStage ? (
        <View style={styles.stickyActionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, updating && styles.actionDisabled]}
            disabled={updating}
            onPress={() => { void submitSellerDecision("approve"); }}
          >
            <Text style={styles.actionText}>
              {updating
                ? "İşleniyor..."
                : buyerRequestedDelivery
                  ? (decisionDeliveryType === "delivery"
                    ? t('cta.seller.orderDetail.approveDelivery')
                    : t('cta.seller.orderDetail.approvePickup'))
                  : "Onayla ve Ödemeyi Al"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : action ? (
        <View style={styles.stickyActionBar}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              actionColors ? { backgroundColor: actionColors.bg, borderColor: actionColors.border } : null,
              updating && styles.actionDisabled,
            ]}
            disabled={updating}
            onPress={() => {
              if (shouldCheckPinBeforeComplete) {
                setPinModalVisible(true);
                return;
              }
              void runAction(action);
            }}
          >
            <Text style={styles.actionText}>
              {shouldCheckPinBeforeComplete ? "Kodu Doğrula" : action.label}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal visible={pinModalVisible} transparent animationType="fade" onRequestClose={() => setPinModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.pinModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity style={styles.pinModalBackdrop} activeOpacity={1} onPress={() => setPinModalVisible(false)} />
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>Kodu Doğrula</Text>
            <Text style={styles.pinModalSub}>Alıcıdan aldığın kodu gir.</Text>
            <TextInput
              style={styles.pinInput}
              value={pinCode}
              onChangeText={(value) => setPinCode(value.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              maxLength={8}
              placeholder="Kodu gir (4-8 hane)"
              placeholderTextColor="#9C8E81"
              editable={!updating}
              autoFocus
            />
            <View style={styles.pinModalActions}>
              <TouchableOpacity
                style={[styles.pinModalBtn, styles.pinModalCancelBtn]}
                onPress={() => setPinModalVisible(false)}
                disabled={updating}
              >
                <Text style={styles.pinModalCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pinModalBtn,
                  styles.pinModalConfirmBtn,
                  (updating || !isPinReady) && styles.actionDisabled,
                ]}
                onPress={() => {
                  void handlePinVerifyFromModal();
                }}
                disabled={updating || !isPinReady}
              >
                <Text style={styles.pinModalConfirmText}>{updating ? "Doğrulanıyor..." : "Doğrula"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 36, gap: 10 },
  contentWithStickyAction: { paddingBottom: 132 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderNo: { fontSize: 17, fontWeight: "800", color: "#2E241C" },
  meta: { marginTop: 4, color: "#6C6055" },
  deliveryRequestBanner: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CFE4D5",
    backgroundColor: "#F3FAF5",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  deliveryRequestTitle: { color: "#2F6F4A", fontWeight: "800", marginBottom: 4 },
  deliveryRequestText: { color: "#456957", lineHeight: 18 },
  sectionTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 4 },
  linkText: { textDecorationLine: "underline" },
  itemRowWrap: { marginTop: 4 },
  addonMeta: { marginTop: 4, color: "#8A7D72", fontSize: 12.5 },
  inlineFieldLabel: { marginTop: 12, color: "#2E241C", fontWeight: "700" },
  choiceRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  choiceChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCCFBF",
    backgroundColor: "#F8F4ED",
    paddingVertical: 10,
    alignItems: "center",
  },
  choiceChipActive: {
    borderColor: "#3F855C",
    backgroundColor: "#EAF5EE",
  },
  choiceChipText: { color: "#5B4F43", fontWeight: "700" },
  choiceChipTextActive: { color: "#2D6A45" },
  noteInput: {
    minHeight: 84,
    textAlignVertical: "top",
    letterSpacing: 0,
  },
  decisionActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  secondaryActionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCCFBF",
    backgroundColor: "#F6F1E8",
    paddingVertical: 11,
    alignItems: "center",
  },
  secondaryActionText: { color: "#5B4F43", fontWeight: "700" },
  rejectActionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C0392B",
    backgroundColor: "#FDECEC",
    paddingVertical: 11,
    alignItems: "center",
  },
  rejectActionText: { color: "#A1261A", fontWeight: "700" },
  productsTotalRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#EDE5D8",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  productsTotalLabel: { color: "#2E241C", fontWeight: "700" },
  productsTotalValue: { color: "#2E241C", fontWeight: "800" },
  pinInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#DCCFBF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#2E241C",
    fontWeight: "600",
    letterSpacing: 1.5,
  },
  actionBtn: { marginTop: 8, backgroundColor: "#3F855C", borderRadius: 10, borderWidth: 1, paddingVertical: 11, alignItems: "center" },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontWeight: "700" },
  stickyActionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    backgroundColor: "#F7F4EF",
    borderTopWidth: 1,
    borderTopColor: "#E5DDCF",
  },
  pinModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pinModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pinModalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 14,
  },
  pinModalTitle: { color: "#2E241C", fontWeight: "800", fontSize: 17 },
  pinModalSub: { color: "#6C6055", marginTop: 4 },
  pinModalActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  pinModalBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
  },
  pinModalCancelBtn: { backgroundColor: "#F6F1E8", borderColor: "#DCCFBF" },
  pinModalConfirmBtn: { backgroundColor: "#3F855C", borderColor: "#3F855C" },
  pinModalCancelText: { color: "#5B4F43", fontWeight: "700" },
  pinModalConfirmText: { color: "#fff", fontWeight: "700" },
});
