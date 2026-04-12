import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { formatCopy, t } from "../copy/brandCopy";
import { getCurrentLanguage } from "../utils/settings";

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
  return new Intl.DateTimeFormat(getCurrentLanguage() === "en" ? "en-GB" : "tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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

function normalizeOrderDetail(value: unknown, fallbackOrderId: string): OrderDetail | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    ...(row as unknown as OrderDetail),
    id: String(row.id ?? fallbackOrderId ?? "").trim(),
    orderNo: typeof row.orderNo === "string" ? row.orderNo : undefined,
  };
}

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
  throw new Error(t("error.common.mapOpenFailed"));
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
  if (status === "pending_buyer_confirmation") return "pending_buyer_confirmation";
  return status;
}

function getNextAction(status: string, deliveryType?: string): { label: string; toStatus: string } | null {
  const normalized = normalizeFlowStatus(status);
  const pickup = deliveryType === "pickup";
  if (normalized === "paid") {
    return { label: t("cta.seller.home.startPreparing"), toStatus: "preparing" };
  }
  if (normalized === "preparing") {
    return { label: t("cta.seller.home.markReady"), toStatus: "ready" };
  }
  // Pickup: seller owns seller flow and can update in parallel with buyer flow.
  if (pickup) {
    if (normalized === "ready") return { label: t("cta.seller.home.onTheWay"), toStatus: "in_delivery" };
    if (normalized === "in_delivery") return { label: t("cta.seller.home.approaching"), toStatus: "approaching" };
    if (normalized === "approaching") return { label: t("cta.seller.home.atDoor"), toStatus: "at_door" };
    if (normalized === "at_door") return { label: t("status.common.badge.delivered"), toStatus: "completed" };
    return null;
  }
  // Delivery flow
  if (normalized === "ready") {
    return { label: t("cta.seller.home.leftForDelivery"), toStatus: "in_delivery" };
  }
  if (normalized === "in_delivery") return { label: t("status.common.badge.approaching"), toStatus: "approaching" };
  if (normalized === "approaching") return { label: t("status.common.badge.atDoor"), toStatus: "at_door" };
  if (normalized === "at_door") return { label: t("status.common.badge.delivered"), toStatus: "delivered" };
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

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [decisionDeliveryType, setDecisionDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [decisionEtaMinutes, setDecisionEtaMinutes] = useState("30");
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const [orderNotes, setOrderNotes] = useState<Array<{id: string; senderRole: string; senderName: string; message: string; createdAt: string | null}>>([]);
  const [noteInput, setNoteInput] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const notesScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

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
      if (!res.ok) throw new Error(json?.error?.message ?? t("error.seller.orderDetail.load"));
      setOrder(normalizeOrderDetail(json?.data, orderId));
    } catch (e) {
      Alert.alert(t("headline.common.error"), e instanceof Error ? e.message : t("error.seller.orderDetail.load"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrder();
  }, [orderId]);

  async function fetchNotes() {
    if (!order) return;
    const res = await authedFetch(`/v1/orders/${order.id}/notes`);
    if (!res.ok) return;
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json?.data)) {
      setOrderNotes(json.data);
    }
  }

  useEffect(() => {
    if (order?.id) {
      void fetchNotes();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  async function sendNote() {
    const msg = noteInput.trim();
    if (!msg || noteSending || !order) return;
    setNoteSending(true);
    try {
      const res = await authedFetch(`/v1/orders/${order.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        Alert.alert(t('headline.common.error'), json?.error?.message ?? t('error.orderNotes.sendFailed'));
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (json?.data) {
        setOrderNotes(prev => [...prev, json.data]);
      }
      setNoteInput('');
      setTimeout(() => notesScrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch {
      Alert.alert(t('headline.common.error'), t('error.orderNotes.sendFailed'));
    } finally {
      setNoteSending(false);
    }
  }

  async function refreshOrderStatus() {
    try {
      const res = await authedFetch(`/v1/orders/${orderId}`);
      const json = await res.json();
      if (res.ok) setOrder(normalizeOrderDetail(json?.data, orderId));
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
    statusPollRef.current = setInterval(() => { void refreshOrderStatus(); }, 20_000);
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


  const action = useMemo(() => {
    if (!order) return null;
    return getNextAction(order.status, order.deliveryType);
  }, [order?.status, order?.deliveryType]);
  const isDecisionStage = Boolean(order && normalizeFlowStatus(order.status) === "pending_seller_approval");
  const isPendingBuyerConfirmation = Boolean(order && normalizeFlowStatus(order.status) === "pending_buyer_confirmation");
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
    if (!shouldCheckPinBeforeComplete) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(timer);
  }, [shouldCheckPinBeforeComplete]);
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
  const orderLabel = useMemo(() => {
    if (!order) return "";
    const fallbackId = String(order.id || orderId).trim();
    return order.orderNo?.trim() || (fallbackId ? `#${fallbackId.slice(0, 8).toUpperCase()}` : "-");
  }, [order, orderId]);
  const buyerRequestedDelivery = useMemo(
    () => Boolean(
      order &&
      order.requestedDeliveryType === "delivery" &&
      order.activeDeliveryType !== "delivery"
    ),
    [order]
  );
  const canResolveApprovedDeliveryRequest = Boolean(order && order.status === "seller_approved" && buyerRequestedDelivery);
  const hasStickyActionBar = Boolean(action || (isDecisionStage && !isPendingBuyerConfirmation) || canResolveApprovedDeliveryRequest);
  const showStickyActionBar = hasStickyActionBar;

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
      if (!res.ok) throw new Error(json?.error?.message ?? t("error.seller.orderDetail.decisionSave"));
      await loadOrder();
      Alert.alert(
        t("headline.common.success"),
        decision === "approve"
          ? t("status.seller.orderDetail.decisionApproved")
          : decision === "revise"
            ? t("status.seller.orderDetail.decisionRevised")
            : t("status.seller.orderDetail.decisionRejected"),
      );
    } catch (e) {
      Alert.alert(t("headline.common.error"), e instanceof Error ? e.message : t("error.seller.orderDetail.decisionSave"));
    } finally {
      setUpdating(false);
    }
  }

  async function resolveApprovedDeliveryRequest() {
    if (!order || !canResolveApprovedDeliveryRequest) return;
    setUpdating(true);
    try {
      const etaMinutes = Number(decisionEtaMinutes);
      const res = await authedFetch(`/v1/orders/${order.id}/seller-delivery-request-response`, {
        method: "POST",
        body: JSON.stringify({
          deliveryType: decisionDeliveryType,
          etaMinutes,
          note: decisionNote.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? t("error.seller.orderDetail.deliveryRequestResolve"));
      await loadOrder();
      Alert.alert(
        t("headline.common.success"),
        decisionDeliveryType === "delivery"
          ? t("status.seller.orderDetail.deliveryRequestAccepted")
          : t("status.seller.orderDetail.deliveryRequestKeptPickup"),
      );
    } catch (e) {
      Alert.alert(t("headline.common.error"), e instanceof Error ? e.message : t("error.seller.orderDetail.deliveryRequestResolve"));
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
        if (!res.ok) throw new Error(json?.error?.message ?? t("error.seller.orderDetail.statusUpdate"));
      };
      const verifyPin = async (pin: string) => {
        const res = await authedFetch(`/v1/orders/${order.id}/delivery-proof/pin/verify`, {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? t("error.seller.orderDetail.pinVerify"));
      };

      try {
        if (shouldCheckPinBeforeComplete) {
          const pin = pinCode.trim();
          if (!/^\d{4,8}$/.test(pin)) throw new Error(t("error.seller.orderDetail.pinInvalid"));
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
          throw new Error(t("error.seller.orderDetail.nextStepChanged"));
        }
        if (message.includes("PIN")) {
          throw new Error(t("error.seller.orderDetail.pinCheck"));
        }
        throw error;
      }
      await loadOrder();
      return true;
    } catch (e) {
      Alert.alert(t("headline.common.error"), e instanceof Error ? e.message : t("error.seller.orderDetail.statusUpdate"));
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScreenHeader title={t("headline.seller.orderDetail.title")} onBack={onBack} />
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          shouldCheckPinBeforeComplete ? styles.contentWithPinCheck : null,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="interactive"
      >
      {loading || !order ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
          <>
            <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderNo}>{orderLabel}</Text>
              <StatusBadge
                status={sellerStatusBadgeKey}
                size="sm"
                deliveryType={order.deliveryType === "pickup" ? undefined : order.deliveryType}
              />
            </View>
            <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.buyer", { name: order.buyerName || "-" })}</Text>
            <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.type", {
              type: order.deliveryType === "delivery" ? t("cta.seller.orderDetail.delivery") : t("cta.seller.orderDetail.pickup"),
            })}</Text>
            {buyerRequestedDelivery ? (
              <View style={styles.deliveryRequestBanner}>
                <Text style={styles.deliveryRequestTitle}>{t('helper.seller.orderDetail.deliveryRequestTitle')}</Text>
                <Text style={styles.deliveryRequestText}>{t('helper.seller.orderDetail.deliveryRequestBody')}</Text>
              </View>
            ) : null}
            {order.createdAt ? <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.date", { date: formatOrderDate(order.createdAt) })}</Text> : null}
            {order.deliveryType === "delivery" ? (
              <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.deliveryFee", { amount: deliveryFee.toFixed(2) })}</Text>
            ) : null}
          </View>
          {order.deliveryType === "delivery" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.address")}</Text>
              <TouchableOpacity
                activeOpacity={mapAddressText ? 0.78 : 1}
                disabled={!mapAddressText}
                onPress={() => {
                  if (!mapAddressText) return;
                  openAddressInMapsWithCoordinates(mapAddressText, mapCoordinates).catch((error) => {
                    Alert.alert(t("headline.common.error"), error instanceof Error ? error.message : t("error.common.mapOpenFailed"));
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
              <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.decision")}</Text>
              <Text style={styles.meta}>
                {buyerRequestedDelivery
                  ? t('helper.seller.orderDetail.deliveryRequestBody')
                  : t("helper.seller.orderDetail.defaultDecisionBody")}
              </Text>

              <Text style={styles.inlineFieldLabel}>{t("label.seller.orderDetail.deliveryType")}</Text>
              <View style={styles.choiceRow}>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "pickup" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("pickup")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "pickup" && styles.choiceChipTextActive]}>
                    {buyerRequestedDelivery ? t('cta.seller.orderDetail.keepPickup') : t("cta.seller.orderDetail.pickup")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "delivery" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("delivery")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "delivery" && styles.choiceChipTextActive]}>
                    {buyerRequestedDelivery ? t('cta.seller.orderDetail.canDeliver') : t("cta.seller.orderDetail.delivery")}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inlineFieldLabel}>
                {decisionDeliveryType === "delivery" ? t("label.seller.orderDetail.etaDelivery") : t("label.seller.orderDetail.etaPickup")}
              </Text>
              <TextInput
                style={styles.pinInput}
                value={decisionEtaMinutes}
                onChangeText={(value) => setDecisionEtaMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                placeholder={t("helper.seller.orderDetail.etaPlaceholder")}
                placeholderTextColor="#9C8E81"
              />

              <Text style={styles.inlineFieldLabel}>
                {buyerRequestedDelivery
                  ? t("label.seller.orderDetail.noteDecision")
                  : (decisionDeliveryType === "delivery" ? t("label.seller.orderDetail.noteDelivery") : t("label.seller.orderDetail.notePickup"))}
              </Text>
              <TextInput
                style={[styles.pinInput, styles.noteInput]}
                value={decisionNote}
                onChangeText={setDecisionNote}

                multiline
                placeholder={buyerRequestedDelivery
                  ? (decisionDeliveryType === "delivery"
                    ? t("helper.seller.orderDetail.noteDecisionDeliveryPlaceholder")
                    : t("helper.seller.orderDetail.noteDecisionPickupPlaceholder"))
                  : (decisionDeliveryType === "delivery"
                    ? t("helper.seller.orderDetail.noteDeliveryPlaceholder")
                    : t("helper.seller.orderDetail.notePickupPlaceholder"))}
                placeholderTextColor="#9C8E81"
              />

              <Text style={styles.inlineFieldLabel}>{t("label.seller.orderDetail.cancelReason")}</Text>
              <TextInput
                style={[styles.pinInput, styles.noteInput]}
                value={decisionReason}
                onChangeText={setDecisionReason}

                multiline
                placeholder={t("helper.seller.orderDetail.cancelReasonPlaceholder")}
                placeholderTextColor="#9C8E81"
              />

              <View style={styles.decisionActions}>
                <TouchableOpacity
                  style={[styles.secondaryActionBtn, updating && styles.actionDisabled]}
                  disabled={updating}
                  onPress={() => { void submitSellerDecision("revise"); }}
                >
                  <Text style={styles.secondaryActionText}>
                    {buyerRequestedDelivery ? t("cta.seller.orderDetail.sendExplanation") : t("cta.seller.orderDetail.revise")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectActionBtn, updating && styles.actionDisabled]}
                  disabled={updating}
                  onPress={() => { void submitSellerDecision("reject"); }}
                >
                  <Text style={styles.rejectActionText}>
                    {buyerRequestedDelivery ? t("cta.seller.orderDetail.rejectOrderRequest") : t("cta.seller.orderDetail.reject")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {isPendingBuyerConfirmation ? (
            <View style={styles.pendingBuyerCard}>
              <Text style={styles.pendingBuyerTitle}>{t('status.seller.orderDetail.pendingBuyerConfirmation')}</Text>
              <Text style={styles.pendingBuyerBody}>{t('helper.seller.orderDetail.pendingBuyerConfirmationBody')}</Text>
              {order.sellerDeliveryNote ? (
                <Text style={styles.pendingBuyerNote}>{order.sellerDeliveryNote}</Text>
              ) : null}
            </View>
          ) : null}
          {(isDecisionStage || isPendingBuyerConfirmation) ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t('headline.orderNotes.title')}</Text>
              {orderNotes.length === 0 ? (
                <Text style={styles.meta}>{t('helper.orderNotes.emptyBuyer')}</Text>
              ) : (
                <ScrollView
                  ref={notesScrollRef}
                  style={styles.notesScroll}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {orderNotes.map(note => (
                    <View
                      key={note.id}
                      style={[
                        styles.noteBubble,
                        note.senderRole === 'seller' ? styles.noteBubbleSelf : styles.noteBubbleOther,
                      ]}
                    >
                      <Text style={styles.noteSenderName}>
                        {note.senderRole === 'seller' ? t('label.orderNotes.you') : note.senderName}
                      </Text>
                      <Text style={styles.noteText}>{note.message}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
              <TextInput
                style={styles.noteTextInput}
                value={noteInput}
                onChangeText={setNoteInput}
                placeholder={t('placeholder.orderNotes.input')}
                placeholderTextColor="#9C8E81"
                multiline
                maxLength={500}
              />
              <View style={styles.noteActions}>
                <TouchableOpacity
                  style={[styles.noteSendBtn, (noteSending || !noteInput.trim()) && styles.actionDisabled]}
                  disabled={noteSending || !noteInput.trim()}
                  onPress={() => void sendNote()}
                >
                  <Text style={styles.noteSendText}>{t('cta.orderNotes.send')}</Text>
                </TouchableOpacity>
                {isDecisionStage ? (
                  <TouchableOpacity
                    style={[styles.noteApproveBtn, updating && styles.actionDisabled]}
                    disabled={updating}
                    onPress={() => void submitSellerDecision('approve')}
                  >
                    <Text style={styles.noteApproveText}>{t('cta.orderNotes.approve')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}
          {canResolveApprovedDeliveryRequest ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.deliveryRequestDecision")}</Text>
              <Text style={styles.meta}>{t("helper.seller.orderDetail.deliveryRequestResolveBody")}</Text>

              <Text style={styles.inlineFieldLabel}>{t("label.seller.orderDetail.deliveryType")}</Text>
              <View style={styles.choiceRow}>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "pickup" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("pickup")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "pickup" && styles.choiceChipTextActive]}>
                    {t('cta.seller.orderDetail.keepPickup')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.choiceChip, decisionDeliveryType === "delivery" && styles.choiceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setDecisionDeliveryType("delivery")}
                >
                  <Text style={[styles.choiceChipText, decisionDeliveryType === "delivery" && styles.choiceChipTextActive]}>
                    {t('cta.seller.orderDetail.canDeliver')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inlineFieldLabel}>
                {decisionDeliveryType === "delivery" ? t("label.seller.orderDetail.etaDelivery") : t("label.seller.orderDetail.etaPickup")}
              </Text>
              <TextInput
                style={styles.pinInput}
                value={decisionEtaMinutes}
                onChangeText={(value) => setDecisionEtaMinutes(value.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                placeholder={t("helper.seller.orderDetail.etaPlaceholder")}
                placeholderTextColor="#9C8E81"
              />

              <Text style={styles.inlineFieldLabel}>{t("label.seller.orderDetail.noteDecision")}</Text>
              <TextInput
                style={[styles.pinInput, styles.noteInput]}
                value={decisionNote}
                onChangeText={setDecisionNote}

                multiline
                placeholder={decisionDeliveryType === "delivery"
                  ? t("helper.seller.orderDetail.noteDecisionDeliveryPlaceholder")
                  : t("helper.seller.orderDetail.noteDecisionPickupPlaceholder")}
                placeholderTextColor="#9C8E81"
              />
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.products")}</Text>
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
                    {formatCopy("status.seller.orderDetail.freeAddons", {
                      addons: (item.selectedAddons?.free ?? []).map((addon) => addon.name).join(", "),
                    })}
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
              <Text style={styles.productsTotalLabel}>{t("status.seller.orderDetail.total")}</Text>
              <Text style={styles.productsTotalValue}>{Number(order.totalPrice ?? 0).toFixed(2)} TL</Text>
            </View>
          </View>
          {(order.sellerPromisedAt || order.sellerDeliveryNote || order.sellerDeliveryTermsSnapshot) ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.activePlan")}</Text>
              <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.planType", {
                type: order.activeDeliveryType === "delivery" ? t("cta.seller.orderDetail.delivery") : t("cta.seller.orderDetail.pickup"),
              })}</Text>
              {order.sellerPromisedAt ? <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.targetTime", { date: formatOrderDate(order.sellerPromisedAt) })}</Text> : null}
              {order.sellerDeliveryNote ? <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.orderNote", { note: order.sellerDeliveryNote })}</Text> : null}
              {order.sellerDeliveryTermsSnapshot ? <Text style={styles.meta}>{formatCopy("status.seller.orderDetail.generalTerms", { terms: order.sellerDeliveryTermsSnapshot })}</Text> : null}
            </View>
          ) : null}

          {action ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("headline.seller.orderDetail.actions")}</Text>
              {shouldCheckPinBeforeComplete ? (
                <Text style={styles.meta}>{t("helper.seller.orderDetail.verifyBuyerPin")}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      </ScrollView>

      {showStickyActionBar && isDecisionStage && !isPendingBuyerConfirmation ? (
        <View style={styles.stickyActionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, updating && styles.actionDisabled]}
            disabled={updating}
            onPress={() => { void submitSellerDecision("approve"); }}
          >
            <Text style={styles.actionText}>
              {updating
                ? t("status.seller.orderDetail.processing")
                : buyerRequestedDelivery
                  ? (decisionDeliveryType === "delivery"
                    ? t('cta.seller.orderDetail.approveDelivery')
                    : t('cta.seller.orderDetail.approvePickup'))
                  : t("cta.seller.orderDetail.approveAndCapture")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : showStickyActionBar && canResolveApprovedDeliveryRequest ? (
        <View style={styles.stickyActionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, updating && styles.actionDisabled]}
            disabled={updating}
            onPress={() => { void resolveApprovedDeliveryRequest(); }}
          >
            <Text style={styles.actionText}>
              {updating
                ? t("status.seller.orderDetail.processing")
                : decisionDeliveryType === "delivery"
                  ? t('cta.seller.orderDetail.approveDelivery')
                  : t('cta.seller.orderDetail.approvePickup')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : showStickyActionBar && action ? (
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
              {shouldCheckPinBeforeComplete ? t("cta.seller.orderDetail.verifyCode") : action.label}
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
            <Text style={styles.pinModalTitle}>{t("headline.seller.orderDetail.pinModalTitle")}</Text>
            <Text style={styles.pinModalSub}>{t("helper.seller.orderDetail.pinModalSubtitle")}</Text>
            <TextInput
              style={styles.pinInput}
              value={pinCode}
              onChangeText={(value) => setPinCode(value.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              maxLength={8}
              placeholder={t("helper.seller.orderDetail.pinPlaceholder")}
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
                <Text style={styles.pinModalCancelText}>{t("cta.common.cancel")}</Text>
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
                <Text style={styles.pinModalConfirmText}>{updating ? t("status.seller.orderDetail.verifying") : t("cta.seller.orderDetail.confirmVerify")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  contentWithPinCheck: { paddingBottom: 96 },
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
  pendingBuyerCard: {
    backgroundColor: "#F3FAF5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CFE4D5",
    padding: 12,
  },
  pendingBuyerTitle: { color: "#1F6F43", fontWeight: "800", marginBottom: 4 },
  pendingBuyerBody: { color: "#3D6B4F", lineHeight: 18 },
  pendingBuyerNote: { marginTop: 6, color: "#456957", lineHeight: 18 },
  notesScroll: { maxHeight: 200, marginBottom: 8 },
  noteBubble: { borderRadius: 10, padding: 10, marginBottom: 6, maxWidth: '85%' },
  noteBubbleSelf: { backgroundColor: '#EAF5EE', alignSelf: 'flex-end', borderWidth: 1, borderColor: '#C3E0CC' },
  noteBubbleOther: { backgroundColor: '#F6F1E8', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5DDCF' },
  noteSenderName: { fontSize: 11, fontWeight: '700', color: '#8A7D72', marginBottom: 2 },
  noteText: { fontSize: 14, color: '#2E241C', lineHeight: 20 },
  noteTextInput: {
    borderWidth: 1,
    borderColor: '#E5DDCF',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#2E241C',
    backgroundColor: '#FDFAF6',
    minHeight: 72,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  noteActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  noteSendBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#DCCFBF', backgroundColor: '#F6F1E8', paddingVertical: 11, alignItems: 'center' },
  noteSendText: { color: '#5B4F43', fontWeight: '700', fontSize: 14 },
  noteApproveBtn: { flex: 1, borderRadius: 10, backgroundColor: '#3F855C', borderWidth: 1, borderColor: '#3F855C', paddingVertical: 11, alignItems: 'center' },
  noteApproveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
