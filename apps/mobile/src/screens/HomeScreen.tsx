import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Dimensions,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity as RNTouchableOpacity,
  UIManager,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
let LinearGradient: React.ComponentType<{
  colors: string[];
  locations?: number[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: any;
  children?: React.ReactNode;
}> | null = null;
try {
  const maybeGradient = require('expo-linear-gradient').LinearGradient;
  const hasNativeView = Boolean(
    UIManager.getViewManagerConfig?.('ViewManagerAdapter_ExpoLinearGradient')
      || UIManager.getViewManagerConfig?.('ExpoLinearGradient'),
  );
  LinearGradient = hasNativeView ? maybeGradient : null;
} catch {
  // Optional at runtime; fallback views are used when unavailable.
}
import * as ImagePicker from 'expo-image-picker';
let getColors: typeof import('react-native-image-colors').getColors | null = null;
try {
  getColors = require('react-native-image-colors').getColors;
} catch {
  // Native module not available — adaptive colors will use fallback
}
let manipulateAsync: typeof import('expo-image-manipulator').manipulateAsync | null = null;
let ManipulatorSaveFormat: typeof import('expo-image-manipulator').SaveFormat | null = null;
try {
  const imageManipulator = require('expo-image-manipulator');
  manipulateAsync = imageManipulator.manipulateAsync;
  ManipulatorSaveFormat = imageManipulator.SaveFormat;
} catch {
  // Optional at runtime; local-region sampling falls back to defaults when unavailable.
}
let fileSystemCacheDirectory: string | null = null;
let fileSystemWriteAsStringAsync: null | ((fileUri: string, contents: string, options?: { encoding?: string }) => Promise<void>) = null;
let fileSystemGetInfoAsync: null | ((fileUri: string) => Promise<{ exists: boolean }>) = null;
let fileSystemEncodingTypeBase64: string | null = null;
try {
  const fileSystem = require('expo-file-system');
  fileSystemCacheDirectory = fileSystem.cacheDirectory ?? null;
  fileSystemWriteAsStringAsync = fileSystem.writeAsStringAsync ?? null;
  fileSystemGetInfoAsync = fileSystem.getInfoAsync ?? null;
  fileSystemEncodingTypeBase64 = fileSystem.EncodingType?.Base64 ?? 'base64';
} catch {
  // Optional at runtime; inline image files fall back when unavailable.
}
let PaymentWebView: React.ComponentType<{
  source: { uri: string };
  onNavigationStateChange?: (state: { url?: string }) => void;
  startInLoadingState?: boolean;
  renderLoading?: () => React.ReactElement | null;
}> | null = null;
try {
  PaymentWebView = require('react-native-webview').WebView;
} catch {
  // WebView native module is optional at runtime; fallback is external link.
}
import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from '../utils/settings';
import { subscribeBuyerFeedRealtime, subscribeBuyerOrdersRealtime } from '../utils/realtime';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { loadCachedProfileImageUrl, saveCachedProfileImageUrl } from '../utils/profileImage';
import { apiRequest } from '../utils/api';
import { readJsonSafe } from '../utils/http';
import { theme } from '../theme/colors';
import { formatPrice } from '../components/OrderCard';
import ProfileEditScreen from './ProfileEditScreen';
import AddressScreen from './AddressScreen';
import { type BrandCopyKey, formatCopy, randomHomeGreetingSubtitle, requestErrorLine, t } from '../copy/brandCopy';
import { HOME_FEED_CATEGORIES } from '../constants/foodCategories';

const AnimatedTouchableOpacity: any = Animated.createAnimatedComponent(RNTouchableOpacity as any);
const PICKUP_ADDRESS_REQUEST_TIMEOUT_MS = 12000;
const BUYER_HOME_TAB_BAR_HEIGHT = 70;

function shouldDisableGlobalPressFx(style: unknown, activeOpacity?: number): boolean {
  if (activeOpacity === 1) return true;
  const flat = StyleSheet.flatten(style as any) as Record<string, unknown> | undefined;
  if (!flat) return false;
  return (
    flat.position === 'absolute'
    && flat.top === 0
    && flat.right === 0
    && flat.bottom === 0
    && flat.left === 0
  );
}

function TouchableOpacity(props: React.ComponentProps<typeof RNTouchableOpacity>) {
  const {
    style,
    onPressIn,
    onPressOut,
    activeOpacity,
    disabled,
    ...rest
  } = props;

  const scale = useRef(new Animated.Value(1)).current;
  const disablePressFx = shouldDisableGlobalPressFx(style, activeOpacity) || Boolean(disabled);
  const flatStyle = StyleSheet.flatten(style as any) as Record<string, any> | undefined;
  const existingTransform = Array.isArray(flatStyle?.transform) ? flatStyle.transform : [];

  const animateScale = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 35,
      bounciness: 0,
    }).start();
  };

  return (
    <AnimatedTouchableOpacity
      {...rest}
      disabled={disabled}
      activeOpacity={activeOpacity ?? 0.88}
      style={[
        style,
        !disablePressFx
          ? {
              transform: [...existingTransform, { scale }],
              shadowColor: '#000',
              shadowOpacity: Platform.OS === 'ios' ? 0.08 : 0.14,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            }
          : null,
      ]}
      onPressIn={(event: GestureResponderEvent) => {
        if (!disablePressFx) animateScale(0.98);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        if (!disablePressFx) animateScale(1);
        onPressOut?.(event);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  auth: AuthSession;
  initialTab?: TabKey;
  onOpenSettings: () => void;
  onOpenOrders: () => void;
  onOpenComplaints: () => void;
  onOpenOrderDetail?: (orderId: string) => void;
  onOpenPayment?: (orderId: string) => void;
  onOpenNotifications?: () => void;
  onOpenChatList?: () => void;
  onOpenChat?: (chatId: string, sellerName: string) => void;
  onOpenFavorites?: () => void;
  onOpenFoodDetail?: (food: any) => void;
  onLogout: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
  onSwitchToSeller?: () => void;
};

type MeProfile = {
  profileImageUrl?: string | null;
  displayName?: string | null;
  fullName?: string | null;
  name?: string | null;
};

type UserAddress = {
  id: string;
  title: string;
  addressLine: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};


type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';

type ApiFoodItem = {
  id: string;
  name: string;
  cardSummary: string;
  description: string;
  price: number;
  deliveryFee?: number | null;
  deliveryOptions?: {
    pickup?: boolean;
    delivery?: boolean;
  } | null;
  imageUrl: string | null;
  imageUrls?: string[];
  rating: string | null;
  reviewCount: number;
  prepTime: number | null;
  maxDistance: number | null;
  distanceKm?: number | null;
  distance?: number | string | null;
  category: string | null;
  allergens?: string[];
  ingredients?: string[];
  menuItems?: Array<{
    name: string;
    categoryId?: string;
    categoryName?: string | null;
    kind?: "sauce" | "extra" | "appetizer";
    pricing?: "free" | "paid";
    price?: number;
  }>;
  secondaryCategories?: Array<{ id: string; name: string }>;
  cuisine?: string | null;
  lotId?: string | null;
  stock: number;
  seller: { id: string; name: string; username?: string | null; image: string | null; tagline?: string | null; homeCardImage?: string | null };
};

type MealCard = {
  id: string;
  title: string;
  sellerId: string;
  seller: string;
  sellerUsername?: string | null;
  sellerImage?: string | null;
  sellerTagline?: string | null;
  sellerHomeCardImage?: string | null;
  allergens: string[];
  ingredients: string[];
  menuItems: string[];
  addons: Array<{
    name: string;
    kind: "sauce" | "extra" | "appetizer";
    pricing: "free" | "paid";
    price?: number;
  }>;
  description: string;
  cuisine: string;
  lotId?: string | null;
  stock: number;
  rating: string;
  time: string;
  distance: string;
  price: string;
  deliveryFee: number;
  deliveryOptions: {
    pickup: boolean;
    delivery: boolean;
  };
  backgroundColor: string;
  category: string;
  imageUrl?: string;
  imageUrls?: string[];
  locationBasisLabel?: string;
};

function formatSellerIdentity(name: string, username?: string | null): string {
  const cleanUsername = (username ?? "").trim().replace(/^@+/, "");
  if (!cleanUsername) return name;
  return `@${cleanUsername}`;
}

function formatCuisineLabel(cuisine?: string | null): string {
  const value = (cuisine ?? "").trim();
  if (!value) return "";
  const lower = value.toLocaleLowerCase("tr-TR");
  if (lower.endsWith(" mutfağı") || lower.endsWith(" mutfagi")) return value;
  return `${value} ${t('helper.home.cuisineSuffix')}`;
}

function normalizeMealAddons(value: ApiFoodItem["menuItems"]): MealCard["addons"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: MealCard["addons"] = [];
  for (const raw of value) {
    const name = String(raw?.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const kind = raw?.kind === "sauce" || raw?.kind === "appetizer" ? raw.kind : "extra";
    const pricing = raw?.pricing === "paid" ? "paid" : "free";
    const parsedPrice = Number(raw?.price);
    const price = Number.isFinite(parsedPrice) ? Number(parsedPrice.toFixed(2)) : undefined;
    const key = `${name.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}|${price ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (pricing === "paid" && price && price > 0) {
      items.push({ name, kind, pricing, price });
    } else {
      items.push({ name, kind, pricing: "free" });
    }
  }
  return items.slice(0, 50);
}

function normalizeDeliveryOptions(
  value: ApiFoodItem["deliveryOptions"],
): { pickup: boolean; delivery: boolean } {
  if (!value || typeof value !== "object") {
    return { pickup: true, delivery: false };
  }
  const pickup = Boolean(value.pickup);
  const delivery = Boolean(value.delivery);
  if (!pickup && !delivery) {
    return { pickup: true, delivery: false };
  }
  return { pickup, delivery };
}

function buildCartItemKey(mealId: string): string {
  return mealId;
}

function mergeCartAddons(
  base: CartItem["selectedAddons"],
  incoming: CartItem["selectedAddons"],
): CartItem["selectedAddons"] {
  const freeMap = new Map<string, CartItem["selectedAddons"]["free"][number]>();
  for (const item of [...base.free, ...incoming.free]) {
    freeMap.set(`${item.name}|${item.kind}`, item);
  }

  const paidMap = new Map<string, CartItem["selectedAddons"]["paid"][number]>();
  for (const item of base.paid) {
    paidMap.set(`${item.name}|${item.kind}|${item.price}`, { ...item });
  }
  for (const item of incoming.paid) {
    const key = `${item.name}|${item.kind}|${item.price}`;
    const existing = paidMap.get(key);
    if (!existing) {
      paidMap.set(key, { ...item });
      continue;
    }
    paidMap.set(key, {
      ...existing,
      quantity: Math.min(10, Number(existing.quantity ?? 0) + Number(item.quantity ?? 0)),
    });
  }

  return {
    free: [...freeMap.values()],
    paid: [...paidMap.values()],
  };
}

function adjustSpecificPaidAddonQuantity(
  selectedAddons: CartItem["selectedAddons"],
  addonToAdjust: CartItem["selectedAddons"]["paid"][number],
  delta: -1 | 1,
): CartItem["selectedAddons"] {
  return {
    ...selectedAddons,
    paid: selectedAddons.paid.flatMap((addon) => {
      const isTarget =
        addon.name === addonToAdjust.name &&
        addon.kind === addonToAdjust.kind &&
        addon.price === addonToAdjust.price;
      if (!isTarget) return [addon];
      const nextQuantity = Math.max(0, Math.min(10, Number(addon.quantity ?? 0) + delta));
      if (nextQuantity <= 0) return [];
      return [{ ...addon, quantity: nextQuantity }];
    }),
  };
}

type FavoriteFoodItem = {
  id: string;
};

type ApiRecommendationItem = ApiFoodItem & {
  reason?: string | null;
  totalSold?: number;
};

type RecommendationMeal = MealCard & {
  reason: string;
};

type UiCategory =
  | 'Çorbalar'
  | 'Ana Yemekler'
  | 'Salata'
  | 'Meze'
  | 'Tatlılar'
  | 'İçecekler';

type CardColors = {
  bg: string;
  border: string;
  title: string;
  subtitle: string;
  price: string;
  meta: string;
  photoTitle: string;
  photoCuisine: string;
  photoStock: string;
  photoMeta: string;
};

type HeroColors = {
  bg: string;
  gradTop: string;
  gradMid: string;
  gradLight: string;
  featherMain: string;
  featherSoft: string;
  overlay: string;
};

type SellerProfile = {
  startedYear: number;
  experienceYears: number;
  bio: string;
};

type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
};

type SellerReview = {
  id: string;
  rating: number;
  comment: string;
  foodName: string;
  buyerName: string;
  createdAt: string;
};

type SellerCompletedSalesResponse = {
  data?: {
    sellerId?: string;
    totalCompletedMeals?: number;
  };
  error?: { message?: string };
};

type CartItem = {
  key: string;
  meal: MealCard;
  quantity: number;
  selectedAddons: {
    free: Array<{ name: string; kind: "sauce" | "extra" | "appetizer" }>;
    paid: Array<{ name: string; kind: "sauce" | "extra" | "appetizer"; price: number; quantity: number }>;
  };
};

type PaymentStatusSnapshot = {
  orderId: string;
  orderStatus: string;
  paymentCompleted: boolean;
  latestAttemptStatus?: string;
};

type DeliveryProofRecord = {
  orderId: string;
  proofMode: string;
  pinSentAt: string | null;
  pinVerifiedAt: string | null;
  verificationAttempts: number;
  status: 'pending' | 'verified' | 'failed' | 'expired';
  pin?: string | null;
};

const CHECKOUT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_CART_BOTTOM_BAR_HEIGHT = 260;

type HomeOrdersApiItem = {
  id: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  requestedDeliveryType?: 'pickup' | 'delivery';
  activeDeliveryType?: 'pickup' | 'delivery';
  sellerDecisionState?: string | null;
  totalPrice: number;
  createdAt: string;
  updatedAt?: string;
  sellerName?: string | null;
  orderNo?: string | null;
  items?: { name: string; quantity: number }[];
  lastSellerNote?: string | null;
};

type HomeOrderSummary = {
  id: string;
  orderNo?: string | null;
  status: string;
  sellerName: string;
  items: { name: string; quantity: number }[];
  totalPrice: number;
  createdAt: string;
  updatedAt?: string;
  deliveryType: 'pickup' | 'delivery';
  requestedDeliveryType: 'pickup' | 'delivery';
  activeDeliveryType: 'pickup' | 'delivery';
  sellerDecisionState?: string | null;
  lastSellerNote?: string | null;
};

const HOME_ACTIONABLE_ORDER_STATUSES = new Set([
  'pending_seller_approval',
  'pending_buyer_confirmation',
  'seller_approved',
  'awaiting_payment',
  'paid',
  'preparing',
  'ready',
  'in_delivery',
  'approaching',
  'at_door',
  'delivered',
]);

function formatOrderStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return '-';
  if (normalized === 'pending_buyer_confirmation') return t('status.home.orderStatus.pending_buyer_confirmation');
  if (normalized === 'pending_seller_approval') return t('status.home.orderStatus.pending_seller_approval');
  if (normalized === 'seller_approved') return t('status.home.orderStatus.seller_approved');
  if (normalized === 'awaiting_payment') return t('status.home.orderStatus.awaiting_payment');
  if (normalized === 'preparing') return t('status.home.orderStatus.preparing');
  if (normalized === 'ready') return t('status.home.orderStatus.ready');
  if (normalized === 'in_delivery') return t('status.home.orderStatus.in_delivery');
  if (normalized === 'approaching') return 'Yaklaştı';
  if (normalized === 'at_door') return t('status.home.orderStatus.at_door');
  if (normalized === 'delivered') return t('status.home.orderStatus.delivered');
  if (normalized === 'completed') return t('status.home.orderStatus.completed');
  if (normalized === 'cancelled') return t('status.home.orderStatus.cancelled');
  if (normalized === 'rejected') return t('status.home.orderStatus.cancelled');
  return status;
}

function formatPaymentAttemptLabel(status?: string): string {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return t('status.home.paymentWaiting');
  if (normalized === 'initiated') return t('status.home.paymentAttempt.initiated');
  if (normalized === 'confirmed') return t('status.home.paymentAttempt.succeeded');
  if (normalized === 'pending') return t('status.home.paymentAttempt.pending');
  if (normalized === 'processing') return t('status.home.paymentAttempt.processing');
  if (normalized === 'succeeded') return t('status.home.paymentAttempt.succeeded');
  if (normalized === 'failed') return t('status.home.paymentAttempt.failed');
  if (normalized === 'canceled') return t('status.home.paymentAttempt.canceled');
  if (normalized === 'requires_action') return t('status.home.paymentAttempt.requires_action');
  return status ?? t('status.home.paymentWaiting');
}

function isHomeActionableOrderStatus(status?: string | null): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return HOME_ACTIONABLE_ORDER_STATUSES.has(normalized);
}

function formatHomeOrderNo(orderId: string, orderNo?: string | null): string {
  const raw = String(orderNo ?? '').trim();
  return raw ? raw : `#${orderId.slice(0, 8).toUpperCase()}`;
}

function formatHomeOrderDate(value?: string): string {
  if (!value) return '-';
  const normalized = value.trim().replace(' ', 'T').replace(/(\.\d+)?([+-]\d{2})$/, '$1$2:00');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '-';
  const day = parsed.getDate().toString().padStart(2, '0');
  const month = (parsed.getMonth() + 1).toString().padStart(2, '0');
  const hours = parsed.getHours().toString().padStart(2, '0');
  const minutes = parsed.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}\u00A0${hours}:${minutes}`;
}

function homeOrderTime(order: Pick<HomeOrderSummary, 'createdAt' | 'updatedAt'>): number {
  const primary = order.updatedAt || order.createdAt;
  const normalized = String(primary ?? '').trim().replace(' ', 'T').replace(/(\.\d+)?([+-]\d{2})$/, '$1$2:00');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function summarizeHomeOrderItems(items: HomeOrderSummary['items']): string {
  const summary = items
    .slice(0, 2)
    .map((item) => `${item.quantity}x ${item.name}`)
    .join(' · ');
  return summary || t('helper.orders.itemsFallback');
}

function latestHomeOrderHint(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'pending_seller_approval' || normalized === 'pending_buyer_confirmation' || normalized === 'seller_approved' || normalized === 'awaiting_payment' || normalized === 'paid') {
    return t('helper.orders.quickPendingSubtitle');
  }
  if (normalized === 'ready') return t('helper.orders.quickReadySubtitle');
  if (normalized === 'in_delivery') return t('helper.orders.quickInDeliverySubtitle');
  if (normalized === 'approaching') return t('helper.orders.quickApproachingSubtitle');
  if (normalized === 'at_door') return t('helper.orders.quickAtDoorSubtitle');
  return t('helper.orders.quickPreparingSubtitle');
}

function quickOrderLiveStatus(status: string): { label: string; tone: 'soft' | 'warn' | 'accent' } {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized === 'pending_buyer_confirmation') {
    return { label: 'Teklifini bekliyor', tone: 'warn' };
  }
  if (normalized === 'pending_seller_approval') {
    return { label: 'Onay bekleniyor', tone: 'warn' };
  }
  if (normalized === 'seller_approved') {
    return { label: 'Onaylandı', tone: 'soft' };
  }
  if (normalized === 'awaiting_payment') {
    return { label: 'Ödeme alınıyor', tone: 'soft' };
  }
  if (normalized === 'paid' || normalized === 'preparing') {
    return { label: 'Hazırlıyor', tone: 'soft' };
  }
  if (normalized === 'ready') {
    return { label: 'Hazırlandı', tone: 'soft' };
  }
  if (normalized === 'in_delivery') {
    return { label: 'Yola Çıktı', tone: 'accent' };
  }
  if (normalized === 'approaching') {
    return { label: 'Yaklaştı', tone: 'accent' };
  }
  if (normalized === 'at_door') {
    return { label: 'Kapıdayım', tone: 'accent' };
  }
  if (normalized === 'delivered' || normalized === 'completed') {
    return { label: 'Teslim edildi', tone: 'soft' };
  }
  if (normalized === 'cancelled' || normalized === 'rejected') {
    return { label: 'İptal edildi', tone: 'warn' };
  }
  return { label: formatOrderStatusLabel(status), tone: 'soft' };
}

function hasPendingBuyerDeliveryRequest(order: HomeOrderSummary): boolean {
  return order.requestedDeliveryType === 'delivery' && order.activeDeliveryType !== 'delivery';
}

function canRequestBuyerDelivery(order: HomeOrderSummary): boolean {
  return order.status === 'pending_seller_approval' && !hasPendingBuyerDeliveryRequest(order);
}

function canAutoOpenBuyerPickupPayment(order: HomeOrderSummary): boolean {
  const normalizedStatus = String(order.status ?? '').trim().toLowerCase();
  const normalizedDecisionState = String(order.sellerDecisionState ?? '').trim().toLowerCase();
  const decisionAllowed = !normalizedDecisionState || normalizedDecisionState === 'approved';
  return (
    order.deliveryType === 'pickup'
    && !hasPendingBuyerDeliveryRequest(order)
    && decisionAllowed
    && (normalizedStatus === 'seller_approved' || normalizedStatus === 'awaiting_payment')
  );
}

function shouldHideCartQuickOrderCard(order: HomeOrderSummary | null | undefined): boolean {
  if (!order) return false;
  const normalizedStatus = String(order.status ?? '').trim().toLowerCase();
  return (
    order.deliveryType === 'pickup'
    && !hasPendingBuyerDeliveryRequest(order)
    && normalizedStatus === 'pending_seller_approval'
  );
}

function parseDistanceKm(distanceText: string): number | null {
  const normalized = (distanceText || '').replace(',', '.');
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  return value;
}

function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function humanizeHttpError(status: number): string {
  if (status === 502) return t('error.home.serverUnavailable502');
  if (status === 503) return t('error.home.serverUnavailable503');
  if (status === 504) return t('error.home.serverTimeout504');
  if (status >= 500) return `${t('error.home.serverGeneric')} (${status})`;
  return requestErrorLine(status);
}

function isAuthErrorMessage(message: string | null | undefined): boolean {
  const normalized = (message ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('authentication credentials were not provided')
    || normalized.includes('credentials were not provided')
    || normalized.includes('token')
    || normalized.includes('unauthorized')
    || normalized.includes('yetkilendirme')
  );
}

function normalizeHomeRequestError(error: unknown, fallbackKey: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (isAuthErrorMessage(message)) return t('error.home.sessionExpired');
    if (message) return message;
  }
  return t(fallbackKey as any);
}

function areAuthSessionsEqual(a: AuthSession | null | undefined, b: AuthSession | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.accessToken === b.accessToken
    && a.refreshToken === b.refreshToken
    && a.userId === b.userId
    && a.userType === b.userType
    && a.email === b.email
  );
}

function resolveRefreshBaseUrlFromRequest(url: string, fallbackApiUrl: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return fallbackApiUrl;
  }
}

function shouldRetryTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildGreetingTitle(name: string, date = new Date()): { text: string; emoji: string } {
  const hour = date.getHours();
  if (hour < 12) return { text: t('headline.home.greetingMorning').replace('{name}', name), emoji: '🌞' };
  if (hour < 18) return { text: t('headline.home.greetingAfternoon').replace('{name}', name), emoji: '🌤' };
  return { text: t('headline.home.greetingEvening').replace('{name}', name), emoji: '🌙' };
}

function firstNameFromText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  const [first] = normalized.split(' ');
  return first || null;
}

function resolveGreetingName(profile: MeProfile | null | undefined, email?: string): string {
  const fromProfile = firstNameFromText(profile?.displayName)
    ?? firstNameFromText(profile?.fullName)
    ?? firstNameFromText(profile?.name);
  if (fromProfile) return fromProfile;

  const emailName = firstNameFromText((email ?? '').split('@')[0]?.replace(/[._-]+/g, ' '));
  if (emailName) return emailName;

  return 'Lale';
}

function resolveProfileDisplayName(profile: MeProfile | null | undefined, email?: string): string {
  const fromProfile = (profile?.displayName ?? profile?.fullName ?? profile?.name ?? '').trim();
  if (fromProfile) return fromProfile;

  const emailName = (email ?? '').split('@')[0]?.trim();
  if (emailName) return emailName;

  return 'Komşu';
}


function resolveGreetingTitleMetrics(text: string): { fontSize: number; lineHeight: number } {
  if (text.length >= 30) return { fontSize: 22, lineHeight: 31 };
  if (text.length >= 26) return { fontSize: 24, lineHeight: 34 };
  if (text.length >= 21) return { fontSize: 27, lineHeight: 38 };
  if (text.length >= 16) return { fontSize: 30, lineHeight: 42 };
  return { fontSize: 33, lineHeight: 46 };
}

function resolveFoodPhotoTitleMetrics(text: string): { fontSize: number; lineHeight: number } {
  const length = text.trim().length;
  if (length >= 24) return { fontSize: 26, lineHeight: 30 };
  if (length >= 18) return { fontSize: 31, lineHeight: 35 };
  if (length >= 12) return { fontSize: 36, lineHeight: 39 };
  return { fontSize: 42, lineHeight: 44 };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(
    0,
    Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)),
  );
  const g = Math.max(
    0,
    Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)),
  );
  const b = Math.max(
    0,
    Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function normalizeHexColor(color: string, fallback = '#8A7B6A'): string {
  const normalized = color.trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return fallback;
  return withHash.toUpperCase();
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(
    255,
    Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount),
  );
  const g = Math.min(
    255,
    Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount),
  );
  const b = Math.min(
    255,
    Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex).replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function blendHexColors(fromHex: string, toHex: string, ratio: number): string {
  const a = hexToRgb(fromHex);
  const b = hexToRgb(toHex);
  const t = clamp01(ratio);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bch = Math.round(a.b + (b.b - a.b) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bch.toString(16).padStart(2, '0')}`.toUpperCase();
}

function relativeLuminanceFromHex(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    if (normalized <= 0.03928) return normalized / 12.92;
    return ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getImageSizeAsync(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp >= 1 && hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp >= 2 && hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp >= 3 && hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp >= 4 && hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0')}`.toUpperCase();
}

function colorFromHsl(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(
    ((h % 360) + 360) % 360,
    Math.max(0, Math.min(1, s)),
    Math.max(0, Math.min(1, l)),
  );
  return rgbToHex(r, g, b);
}

function toneFromHue(h: number, saturation: number, lightness: number): string {
  return colorFromHsl(h, saturation, lightness);
}

function isPaletteHexColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return /^#?[0-9a-fA-F]{6}$/.test(normalized);
}

function toRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(normalizeHexColor(hex));
  return `rgba(${r},${g},${b},${alpha})`;
}

function pickImagePaletteColor(result: any, fallback: string): string {
  // Keys ordered by preference; average/background/darkMuted tend to return neutral tones
  const candidateKeys = [
    'vibrant',
    'lightVibrant',
    'primary',
    'detail',
    'secondary',
    'dominant',
    'darkVibrant',
    'muted',
    'lightMuted',
    'darkMuted',
    'average',
    'background',
  ];

  type Candidate = { color: string; score: number };
  const candidates: Candidate[] = [];

  for (const key of candidateKeys) {
    const raw = result?.[key];
    if (!isPaletteHexColor(raw)) continue;
    const color = normalizeHexColor(raw);
    const { r, g, b } = hexToRgb(color);
    const { h, s, l } = rgbToHsl(r, g, b);
    // Skip near-grayscale colors — they'd produce invisible card tints
    if (s < 0.12) continue;
    const vibranceScore = s * 2.8;
    const midLightnessScore = 1 - Math.abs(l - 0.50);
    // Penalise very dark colors
    const darkPenalty = l < 0.22 ? 0.8 : 0;
    // Penalise desaturated / muddy colors more aggressively
    const muddyPenalty = s < 0.35 ? (0.35 - s) * 2.2 : 0;
    // Penalise very light / washed-out colors (they look like white on the card)
    const lightPenalty = l > 0.80 ? (l - 0.80) * 3.5 : 0;
    // Brown/orange mid-tones often come from dish backgrounds, not the food itself
    const brownBand = h >= 16 && h <= 42;
    const brownPenalty = brownBand && l < 0.52 ? 0.5 : 0;
    // vibrant / darkVibrant are the most reliable keys for food color
    const keyBoost =
      key === 'vibrant' || key === 'darkVibrant'
        ? 0.28
        : key === 'primary' || key === 'detail'
          ? 0.18
          : key === 'lightVibrant'
            ? 0.12
            : key === 'secondary'
              ? 0.10
              : key === 'dominant'
                ? 0.04
                : 0;
    const score = vibranceScore + midLightnessScore + keyBoost
      - darkPenalty - muddyPenalty - lightPenalty - brownPenalty;
    candidates.push({ color, score });
  }

  if (!candidates.length) return normalizeHexColor(fallback);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].color;
}

function deriveCardColors(dominant: string): CardColors {
  const safe = normalizeHexColor(dominant);
  const title = darken(safe, 0.62);
  const subtitle = darken(safe, 0.46);
  const price = darken(safe, 0.56);
  const metaBase = darken(safe, 0.38);
  return {
    bg: lighten(safe, 0.96),
    border: lighten(safe, 0.88),
    title,
    subtitle,
    price,
    meta: metaBase,
    photoTitle: lighten(safe, 0.94),
    photoCuisine: lighten(safe, 0.88),
    photoStock: lighten(safe, 0.82),
    photoMeta: lighten(safe, 0.78),
  };
}

const DEFAULT_HERO_SEED = '#F0BB82';

function deriveHeroColors(dominant: string): HeroColors {
  const safe = normalizeHexColor(dominant);
  const { r, g, b } = hexToRgb(safe);
  const { h, s } = rgbToHsl(r, g, b);
  const vividSat = Math.max(0.38, Math.min(0.78, s * 1.1));
  return {
    bg: colorFromHsl(h, vividSat * 0.16, 0.965),
    gradTop: colorFromHsl(h, vividSat * 0.28, 0.935),
    gradMid: colorFromHsl(h, vividSat * 0.40, 0.885),
    gradLight: colorFromHsl(h, vividSat * 0.13, 0.960),
    featherMain: colorFromHsl(h, vividSat * 0.40, 0.885),
    featherSoft: colorFromHsl(h, vividSat * 0.24, 0.930),
    overlay: colorFromHsl(h, vividSat * 0.62, 0.70),
  };
}

// Picks the lightest (highest lightness) sufficiently saturated color from the palette.
// This is used for text overlaid on dark food photos.
function pickLightestPaletteColor(result: any, fallback: string): string {
  const keys = ['lightVibrant', 'lightMuted', 'muted', 'vibrant', 'secondary', 'primary', 'dominant'];
  let bestColor = normalizeHexColor(fallback);
  let bestL = -1;

  for (const key of keys) {
    const raw = result?.[key];
    if (!isPaletteHexColor(raw)) continue;
    const color = normalizeHexColor(raw);
    const { r, g, b } = hexToRgb(color);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.14) continue; // skip near-greys
    if (l > bestL) {
      bestL = l;
      bestColor = color;
    }
  }

  // Boost to a reliably light shade if the candidate is still too mid-tone
  if (bestL >= 0 && bestL < 0.80) {
    const { r, g, b } = hexToRgb(bestColor);
    const { h, s } = rgbToHsl(r, g, b);
    return colorFromHsl(h, Math.max(s, 0.52), 0.90);
  }
  return bestColor;
}

// Picks the palette color that contrasts most with the photo's background:
// highest hue distance + saturation, then lightness is forced to be readable.
function pickContrastingPaletteColor(result: any, bgHex: string, darkBg: boolean, fallback: string): string {
  const keys = ['vibrant', 'lightVibrant', 'darkVibrant', 'primary', 'detail', 'secondary', 'muted', 'lightMuted', 'dominant', 'average', 'background'];
  const bgSafe = normalizeHexColor(bgHex);
  const { r: br, g: bg2, b: bb } = hexToRgb(bgSafe);
  const { h: bh } = rgbToHsl(br, bg2, bb);

  type Candidate = { color: string; score: number };
  const candidates: Candidate[] = [];

  for (const key of keys) {
    const raw = result?.[key];
    if (!isPaletteHexColor(raw)) continue;
    const color = normalizeHexColor(raw);
    const { r, g, b } = hexToRgb(color);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.10) continue;
    // Hue angular distance 0–180
    const rawDist = Math.abs(h - bh) % 360;
    const hueDist = rawDist > 180 ? 360 - rawDist : rawDist;
    const hueScore = hueDist / 180;
    // Vibrant colors pop more
    const satScore = s;
    // Penalise if hue too similar to background
    const huePenalty = hueDist < 20 ? (20 - hueDist) / 20 * 0.7 : 0;
    const score = hueScore * 1.5 + satScore * 1.2 - huePenalty;
    candidates.push({ color, score });
  }

  const winner = candidates.length
    ? candidates.sort((a, b) => b.score - a.score)[0].color
    : normalizeHexColor(fallback);

  const { r, g, b } = hexToRgb(winner);
  const { h, s } = rgbToHsl(r, g, b);
  // For dark photo bg → bright text; for light photo bg → deep text
  const targetL = darkBg ? 0.22 : 0.88;
  return colorFromHsl(h, Math.max(s, 0.60), targetL);
}

function derivePhotoOverlayText(
  overlayColor: string,
  _seed: string,
  _tone: 'light' | 'dark',
): { title: string; cuisine: string } {
  // overlayColor is already lightness-adjusted by pickContrastingPaletteColor
  const { r, g, b } = hexToRgb(normalizeHexColor(overlayColor));
  const { h, s, l } = rgbToHsl(r, g, b);
  // Cuisine: same hue family, slightly less bright/dark
  const cuisineL = l > 0.5 ? Math.max(l - 0.07, 0.72) : Math.min(l + 0.06, 0.30);
  return {
    title: overlayColor,
    cuisine: colorFromHsl(h + 6, Math.max(s * 0.88, 0.32), cuisineL),
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = HOME_FEED_CATEGORIES;

const DAILY_FLASH_MEALS = [
  'Anne usulü mercimek çorbası',
  'Etli taze fasulye',
  'Fırında tavuk ve pilav',
  'Zeytinyağlı yaprak sarma',
  'Sütlaç',
] as const;
const SLOGAN_MARQUEE_GAP = 22;
const PHOTO_TEXT_TONE_CACHE = new Map<string, 'light' | 'dark'>();
const FOOD_CARD_RENDER_URI_CACHE = new Map<string, string>();

function isInlineBase64ImageUri(value: string | null | undefined): value is string {
  const raw = String(value ?? '').trim().toLocaleLowerCase('en-US');
  return raw.startsWith('data:image/') && raw.includes(';base64,');
}

function hashInlineImageUri(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function inlineImageExtension(value: string): string {
  const lower = value.toLocaleLowerCase('en-US');
  if (lower.startsWith('data:image/png')) return 'png';
  if (lower.startsWith('data:image/webp')) return 'webp';
  return 'jpg';
}

const CATEGORY_BG_COLORS: Record<string, string> = {
  Çorbalar: '#F1DED0',
  'Ana Yemekler': '#D8E5D8',
  Salata: '#D9EAD9',
  Meze: '#E1DDF1',
  Tatlılar: '#ECD4D8',
  İçecekler: '#D4DEE8',
};

const CATEGORY_EMOJIS: Record<string, string> = {
  Çorbalar: '🍜',
  'Ana Yemekler': '🍲',
  Salata: '🥗',
  Meze: '🧆',
  Tatlılar: '🧁',
  İçecekler: '🍹',
};

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Çorbalar: 'water-outline',
  'Ana Yemekler': 'restaurant-outline',
  Salata: 'leaf-outline',
  Meze: 'wine-outline',
  Tatlılar: 'ice-cream-outline',
  İçecekler: 'cafe-outline',
};

const CATEGORY_KEYS: Record<string, BrandCopyKey> = {
  'Tümü': 'category.all',
  'Çorbalar': 'category.soups',
  'Ana Yemekler': 'category.mainDishes',
  'Salata': 'category.salads',
  'Meze': 'category.meze',
  'Tatlılar': 'category.desserts',
  'İçecekler': 'category.drinks',
};

const LOCAL_HOME_HEADER_FALLBACK = require('../../assets/images/home-header-fallback.png');
const ENV_HOME_HEADER_IMAGE_URL = (process.env.EXPO_PUBLIC_HOME_HEADER_IMAGE_URL || '').trim();
const DEFAULT_HOME_HEADER_IMAGE_URL =
  'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=1800&q=80';
const HERO_AKCABAT_IMAGE_URL = resolveSecondaryDishImage('Akçaabat Köfte', 'Ana Yemekler');

function normalizeDishText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function inferUiCategory(item: ApiFoodItem): UiCategory {
  const title = normalizeDishText(item.name);
  const sourceCategory = normalizeDishText(item.category ?? '');
  const haystack = `${title} ${sourceCategory}`;

  if (
    haystack.includes('corba') ||
    haystack.includes('mercimek') ||
    haystack.includes('ezogelin') ||
    haystack.includes('iskembe') ||
    haystack.includes('tarhana')
  ) {
    return 'Çorbalar';
  }
  if (
    haystack.includes('salata') ||
    haystack.includes('piyaz') ||
    haystack.includes('kisir') ||
    haystack.includes('cacik')
  ) {
    return 'Salata';
  }
  if (
    haystack.includes('meze') ||
    haystack.includes('haydari') ||
    haystack.includes('ezme') ||
    haystack.includes('humus') ||
    haystack.includes('icli kofte') ||
    haystack.includes('cig kofte')
  ) {
    return 'Meze';
  }
  if (
    haystack.includes('tatli') ||
    haystack.includes('sutlac') ||
    haystack.includes('baklava') ||
    haystack.includes('kunefe')
  ) {
    return 'Tatlılar';
  }
  if (
    haystack.includes('icecek') ||
    haystack.includes('ayran') ||
    haystack.includes('serbet') ||
    haystack.includes('limonata')
  ) {
    return 'İçecekler';
  }
  return 'Ana Yemekler';
}

function resolveDishImage(title: string, category: string | null): string {
  const query = encodeURIComponent(`${title} ${category ?? ''} turkish dish plated`);
  const lock = [...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 997;
  return `https://loremflickr.com/1200/800/${query}?lock=${lock}`;
}

function resolveSecondaryDishImage(title: string, category: string | null): string {
  const normalized = title.toLocaleLowerCase('tr-TR');
  const bucket =
    normalized.includes('çorba') ||
    normalized.includes('corba') ||
    normalized.includes('mercimek') ||
    normalized.includes('ezogelin') ||
    normalized.includes('işkembe') ||
    normalized.includes('iskembe')
      ? [
          'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=1200&q=80',
          'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1200&q=80',
        ]
      : normalized.includes('tatlı') ||
          normalized.includes('tatli') ||
          normalized.includes('sütlaç') ||
          normalized.includes('sutlac') ||
          normalized.includes('baklava') ||
          normalized.includes('künefe') ||
          normalized.includes('kunefe')
        ? [
            'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?auto=format&fit=crop&w=1200&q=80',
          ]
        : [
            'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1529563021893-cc83c992d75d?auto=format&fit=crop&w=1200&q=80',
          ];
  const seed = [...`${title}${category ?? ''}`].reduce(
    (sum, ch) => sum + ch.charCodeAt(0),
    0,
  );
  return bucket[seed % bucket.length];
}

function apiToMealCard(item: ApiFoodItem): MealCard {
  const uiCategory = inferUiCategory(item);
  const normalizedImageUrls = [item.imageUrl ?? '', ...(Array.isArray(item.imageUrls) ? item.imageUrls : [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const menuItems = Array.isArray(item.menuItems)
    ? item.menuItems
      .map((entry) => String(entry?.name ?? "").trim())
      .filter(Boolean)
    : [];
  const addons = normalizeMealAddons(item.menuItems);
  const distanceValueRaw =
    item.maxDistance ??
    item.distanceKm ??
    (typeof item.distance === "number"
      ? item.distance
      : typeof item.distance === "string"
        ? Number(String(item.distance).replace(",", "."))
        : null);
  const distanceText = Number.isFinite(distanceValueRaw as number)
    ? `${Number(distanceValueRaw).toFixed(2)} km`
    : "";
  const normalizedAllergens = (item.allergens ?? [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      const normalized = value.toLocaleLowerCase("tr-TR");
      return Boolean(value) && normalized !== "yok" && normalized !== "yoktur" && normalized !== "-";
    });
  return {
    id: item.id,
    title: item.name,
    sellerId: item.seller.id,
    seller: item.seller.name,
    sellerUsername: item.seller.username ?? null,
    sellerImage: item.seller.image,
    sellerTagline: item.seller.tagline ?? null,
    sellerHomeCardImage: item.seller.homeCardImage ?? null,
    allergens: normalizedAllergens,
    ingredients: item.ingredients ?? [],
    menuItems,
    addons,
    description: item.description ?? '',
    cuisine: item.cuisine ?? '',
    lotId: item.lotId ?? null,
    stock: item.stock ?? 0,
    rating: item.rating ?? '0.0',
    time: item.prepTime ? `${item.prepTime} dk` : '',
    distance: distanceText,
    price: `₺${item.price}`,
    deliveryFee: Number(item.deliveryFee ?? 0),
    deliveryOptions: normalizeDeliveryOptions(item.deliveryOptions),
    backgroundColor: CATEGORY_BG_COLORS[uiCategory] ?? '#E8E3DB',
    category: uiCategory,
    imageUrl: normalizedImageUrls[0] ?? resolveDishImage(item.name, uiCategory),
    imageUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
  };
}

function resolveHomeHeaderImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const nestedDataCandidate = root.data;
  const data = (
    nestedDataCandidate
    && typeof nestedDataCandidate === 'object'
    && !Array.isArray(nestedDataCandidate)
      ? nestedDataCandidate
      : root
  ) as Record<string, unknown>;
  const branding = (data.branding && typeof data.branding === 'object' ? data.branding : null) as Record<string, unknown> | null;
  const home = (data.home && typeof data.home === 'object' ? data.home : null) as Record<string, unknown> | null;
  const themeConfig = (data.theme && typeof data.theme === 'object' ? data.theme : null) as Record<string, unknown> | null;

  const candidates = [
    data.homeHeaderImageUrl,
    data.mobileHomeHeaderImageUrl,
    data.headerImageUrl,
    branding?.homeHeaderImageUrl,
    branding?.mobileHomeHeaderImageUrl,
    home?.headerImageUrl,
    home?.heroImageUrl,
    themeConfig?.homeHeaderImageUrl,
  ];

  for (const item of candidates) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (/^https?:\/\//.test(normalized) || /^data:image\//.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildSellerProfile(
  sellerId: string,
  sellerName: string,
  sellerMeals: MealCard[],
): SellerProfile {
  const nowYear = new Date().getFullYear();
  const seed = hashString(`${sellerId}:${sellerName}`);
  const experienceYears = 4 + (seed % 13); // 4-16 yıl
  const startedYear = nowYear - experienceYears;
  const topCategories = Array.from(
    new Set(
      sellerMeals
        .map((meal) => meal.category)
        .filter((category) => category && category !== 'Tümü'),
    ),
  )
    .slice(0, 2)
    .join(t('status.home.sellerBioSpecialityJoiner'));
  const speciality = topCategories || t('status.home.sellerBioDefaultSpeciality');
  return {
    startedYear,
    experienceYears,
    bio: t('status.home.sellerBioTemplate')
      .replace('{name}', sellerName)
      .replace('{year}', String(startedYear))
      .replace('{speciality}', speciality),
  };
}

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: '1',
    text: 'Canın ne çekiyor? Anlatır mısın, sana en uygun ev yemeklerini bulayım.',
    isUser: false,
  },
];

const INITIAL_INBOX_MESSAGES: ChatMessage[] = [
  {
    id: 'seed-1',
    text: 'Merhaba, yarın için mercimek çorbası ve pilav hazırlayabilirim.',
    isUser: false,
  },
  {
    id: 'seed-2',
    text: 'Teşekkürler, saat 19:00 gibi teslim olur mu?',
    isUser: true,
  },
  {
    id: 'seed-3',
    text: 'Olur. Alerjen bilgisi olarak süt ve kereviz mevcut.',
    isUser: false,
  },
];

const MESSAGE_WALLPAPERS = [
  {
    kind: 'blobs',
    bg: '#F7F3EC',
    c1: 'rgba(74,124,89,0.10)',
    c2: 'rgba(201,149,58,0.10)',
    c3: 'rgba(109,93,79,0.08)',
  },
  {
    kind: 'stripes',
    bg: '#F2F7F3',
    c1: 'rgba(74,124,89,0.16)',
    c2: 'rgba(120,170,132,0.14)',
    c3: 'rgba(61,50,41,0.10)',
  },
  {
    kind: 'grid',
    bg: '#F8F2F4',
    c1: 'rgba(181,112,129,0.18)',
    c2: 'rgba(221,168,128,0.14)',
    c3: 'rgba(107,93,79,0.10)',
  },
  {
    kind: 'rings',
    bg: '#F1F5FA',
    c1: 'rgba(88,120,168,0.20)',
    c2: 'rgba(153,183,220,0.16)',
    c3: 'rgba(93,108,130,0.10)',
  },
  {
    kind: 'diagonal',
    bg: '#F8F5EE',
    c1: 'rgba(187,137,79,0.18)',
    c2: 'rgba(214,179,129,0.14)',
    c3: 'rgba(120,96,74,0.10)',
  },
  {
    kind: 'cards',
    bg: '#F2F8F8',
    c1: 'rgba(67,143,143,0.16)',
    c2: 'rgba(137,199,190,0.12)',
    c3: 'rgba(78,112,110,0.10)',
  },
  {
    kind: 'waves',
    bg: '#F8F2EE',
    c1: 'rgba(197,118,84,0.16)',
    c2: 'rgba(228,165,134,0.12)',
    c3: 'rgba(124,87,72,0.10)',
  },
  {
    kind: 'dots',
    bg: '#F4F3F9',
    c1: 'rgba(122,109,176,0.18)',
    c2: 'rgba(177,166,220,0.14)',
    c3: 'rgba(93,87,126,0.10)',
  },
  {
    kind: 'sunset',
    bg: '#F3F8F0',
    c1: 'rgba(120,163,88,0.16)',
    c2: 'rgba(171,210,137,0.12)',
    c3: 'rgba(95,121,72,0.10)',
  },
  {
    kind: 'minimal',
    bg: '#F9F1F5',
    c1: 'rgba(179,96,143,0.16)',
    c2: 'rgba(219,157,190,0.12)',
    c3: 'rgba(118,81,103,0.10)',
  },
] as const;

/* ------------------------------------------------------------------ */
/*  RecommendationCard                                                 */
/* ------------------------------------------------------------------ */

function RecommendationCard({
  meal,
  onPress,
}: {
  meal: RecommendationMeal;
  onPress: () => void;
}) {
  const [colors, setColors] = useState<CardColors>(
    deriveCardColors(meal.backgroundColor),
  );

  useEffect(() => {
    if (!meal.imageUrl || !getColors) {
      setColors(deriveCardColors(meal.backgroundColor));
      return;
    }

    getColors(meal.imageUrl, {
      fallback: meal.backgroundColor,
      cache: true,
      key: `${meal.id}:${meal.imageUrl}`,
    })
      .then((result) => {
        let dominant = meal.backgroundColor;
        if (Platform.OS === 'ios' && 'background' in result) {
          dominant = result.background;
        } else if (Platform.OS === 'android' && 'dominant' in result) {
          dominant = result.dominant;
        }
        setColors(deriveCardColors(dominant));
      })
      .catch(() => {
        setColors(deriveCardColors(meal.backgroundColor));
      });
  }, [meal.backgroundColor, meal.imageUrl]);

  return (
    <TouchableOpacity
      style={[
        styles.sellerChip,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
        },
      ]}
      activeOpacity={0.86}
      onPress={onPress}
    >
      <View style={[styles.sellerChipAvatar, { backgroundColor: colors.border }]}>
        {meal.imageUrl ? (
          <Image source={{ uri: meal.imageUrl }} style={styles.sellerChipAvatarImage} />
        ) : (
          <Text style={[styles.sellerChipAvatarEmoji, { color: colors.title }]}>🍽️</Text>
        )}
      </View>
      <View style={styles.sellerChipTextWrap}>
        <Text style={[styles.sellerChipName, { color: colors.title }]} numberOfLines={1}>
          {meal.title}
        </Text>
        <Text style={[styles.sellerChipMeta, { color: colors.subtitle }]} numberOfLines={1}>
          {formatSellerIdentity(meal.seller, meal.sellerUsername)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/*  FoodCard                                                           */
/* ------------------------------------------------------------------ */

function FoodCard({
  meal,
  isFavorite,
  favoritePending,
  onPress,
  onFavoritePress,
}: {
  meal: MealCard;
  isFavorite: boolean;
  favoritePending: boolean;
  onPress: () => void;
  onFavoritePress: () => void;
}) {
  const defaultCardImageWidth = Math.max(260, Math.round(Dimensions.get('window').width - 32));
  const [colors, setColors] = useState<CardColors>(
    deriveCardColors(meal.backgroundColor),
  );
  const [paletteSeed, setPaletteSeed] = useState<string>(
    normalizeHexColor(meal.backgroundColor),
  );
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageFrameWidth, setImageFrameWidth] = useState(defaultCardImageWidth);
  const [imageFrameHeight, setImageFrameHeight] = useState(155);
  const [photoTextTone, setPhotoTextTone] = useState<'light' | 'dark'>('light');
  const [photoLightColor, setPhotoLightColor] = useState('#FFFFFF');
  const [sellerThumbFailed, setSellerThumbFailed] = useState(false);
  const [renderableImageUri, setRenderableImageUri] = useState<string | null>(null);
  const textToneRequestRef = useRef(0);
  const primaryImageUrl = imageUrls[0];
  const activeImageUrl = imageUrls[imageIndex] ?? primaryImageUrl;

  useEffect(() => {
    const next = [...(meal.imageUrls ?? []), meal.imageUrl ?? '']
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);
    setImageUrls(next);
    setImageIndex(0);
  }, [meal.imageUrl, meal.imageUrls]);

  useEffect(() => {
    if (!primaryImageUrl || !getColors) {
      setColors(deriveCardColors(meal.backgroundColor));
      setPaletteSeed(normalizeHexColor(meal.backgroundColor));
      return;
    }
    getColors(primaryImageUrl, {
      fallback: meal.backgroundColor,
      cache: true,
      key: `${meal.id}:${primaryImageUrl}`,
    })
      .then((result) => {
        let dominant = meal.backgroundColor;
        if (Platform.OS === 'ios' && 'background' in result) {
          dominant = result.background;
        } else if (Platform.OS === 'android' && 'dominant' in result) {
          dominant = result.dominant;
        }
        const lightColor = pickLightestPaletteColor(result, '#FFFFFF');
        setPaletteSeed(normalizeHexColor(dominant));
        setPhotoLightColor(lightColor);
        setColors(deriveCardColors(dominant));
      })
      .catch(() => {
        setColors(deriveCardColors(meal.backgroundColor));
        setPaletteSeed(normalizeHexColor(meal.backgroundColor));
      });
  }, [primaryImageUrl, meal.backgroundColor]);

  useEffect(() => {
    if (!activeImageUrl || !manipulateAsync || !ManipulatorSaveFormat || !getColors) {
      setPhotoTextTone('light');
      return;
    }
    if (imageFrameWidth < 120 || imageFrameHeight < 80) return;

    let cancelled = false;
    const requestId = ++textToneRequestRef.current;

    const detectTextToneFromVisibleRegion = async () => {
      try {
        const toneCacheKey = `${activeImageUrl}#${imageFrameWidth}x${imageFrameHeight}`;
        const cachedTone = PHOTO_TEXT_TONE_CACHE.get(toneCacheKey);
        if (cachedTone) {
          if (!cancelled && requestId === textToneRequestRef.current) {
            setPhotoTextTone((prev) => (prev === cachedTone ? prev : cachedTone));
          }
          return;
        }

        const { width: sourceWidth, height: sourceHeight } = await getImageSizeAsync(activeImageUrl);
        if (cancelled || requestId !== textToneRequestRef.current) return;

        const sampleFrameX = 10;
        const sampleFrameY = Math.max(0, Math.round(imageFrameHeight * 0.34));
        const sampleFrameWidth = Math.max(
          72,
          Math.min(Math.round(imageFrameWidth * 0.52), imageFrameWidth - 132),
        );
        const maxSampleHeight = Math.max(36, imageFrameHeight - sampleFrameY - 14);
        const sampleFrameHeight = Math.max(
          36,
          Math.min(Math.round(imageFrameHeight * 0.46), maxSampleHeight),
        );

        const scale = Math.max(imageFrameWidth / sourceWidth, imageFrameHeight / sourceHeight);
        const renderedWidth = sourceWidth * scale;
        const renderedHeight = sourceHeight * scale;
        const offsetX = Math.max(0, (renderedWidth - imageFrameWidth) / 2);
        const offsetY = Math.max(0, (renderedHeight - imageFrameHeight) / 2);

        const cropOriginX = Math.max(
          0,
          Math.min(sourceWidth - 2, Math.round((sampleFrameX + offsetX) / scale)),
        );
        const cropOriginY = Math.max(
          0,
          Math.min(sourceHeight - 2, Math.round((sampleFrameY + offsetY) / scale)),
        );
        const cropWidth = Math.max(
          2,
          Math.min(sourceWidth - cropOriginX, Math.round(sampleFrameWidth / scale)),
        );
        const cropHeight = Math.max(
          2,
          Math.min(sourceHeight - cropOriginY, Math.round(sampleFrameHeight / scale)),
        );

        const cropped = await manipulateAsync(
          activeImageUrl,
          [{ crop: { originX: cropOriginX, originY: cropOriginY, width: cropWidth, height: cropHeight } }],
          { compress: 0.45, format: ManipulatorSaveFormat.JPEG, base64: false },
        );
        if (cancelled || requestId !== textToneRequestRef.current) return;

        const sampledColors = await getColors(cropped.uri, {
          fallback: meal.backgroundColor,
          cache: false,
          key: `${activeImageUrl}#text-tone:${cropOriginX}:${cropOriginY}:${cropWidth}:${cropHeight}`,
        });

        let sampledDominant = meal.backgroundColor;
        if (Platform.OS === 'ios' && 'background' in sampledColors) {
          sampledDominant = sampledColors.background;
        } else if (Platform.OS === 'android' && 'dominant' in sampledColors) {
          sampledDominant = sampledColors.dominant;
        }
        setPaletteSeed(normalizeHexColor(sampledDominant));
        const nextColors = deriveCardColors(sampledDominant);
        setColors((prev) => (prev.bg === nextColors.bg && prev.title === nextColors.title ? prev : nextColors));

        const luminance = relativeLuminanceFromHex(sampledDominant);
        const nextTone: 'light' | 'dark' = luminance > 0.47 ? 'dark' : 'light';
        // Pick the most hue-contrasting color from the sampled region for overlay text
        const darkBg = nextTone === 'light'; // dark background → we want bright text
        const overlayColor = pickContrastingPaletteColor(sampledColors, sampledDominant, darkBg, meal.backgroundColor);
        PHOTO_TEXT_TONE_CACHE.set(toneCacheKey, nextTone);
        if (!cancelled && requestId === textToneRequestRef.current) {
          setPhotoTextTone((prev) => (prev === nextTone ? prev : nextTone));
          setPhotoLightColor(overlayColor);
        }
      } catch {
        if (!cancelled && requestId === textToneRequestRef.current) {
          setPhotoTextTone('light');
        }
      }
    };

    void detectTextToneFromVisibleRegion();
    return () => {
      cancelled = true;
    };
  }, [activeImageUrl, imageFrameWidth, imageFrameHeight, meal.backgroundColor]);

  useEffect(() => {
    setSellerThumbFailed(false);
  }, [meal.sellerImage]);

  useEffect(() => {
    if (!activeImageUrl) {
      setRenderableImageUri(null);
      return;
    }

    if (!isInlineBase64ImageUri(activeImageUrl)) {
      setRenderableImageUri(activeImageUrl);
      return;
    }

    const cachedUri = FOOD_CARD_RENDER_URI_CACHE.get(activeImageUrl);
    if (cachedUri) {
      setRenderableImageUri(cachedUri);
      return;
    }

    let cancelled = false;
    setRenderableImageUri(null);

    const materializeInlineImage = async () => {
      try {
        const commaIndex = activeImageUrl.indexOf(',');
        if (commaIndex <= 0) {
          setRenderableImageUri(activeImageUrl);
          return;
        }
        const base64Payload = activeImageUrl.slice(commaIndex + 1);
        if (
          fileSystemCacheDirectory &&
          fileSystemWriteAsStringAsync &&
          fileSystemGetInfoAsync &&
          fileSystemEncodingTypeBase64
        ) {
          const extension = inlineImageExtension(activeImageUrl);
          const fileUri = `${fileSystemCacheDirectory}food-card-${hashInlineImageUri(activeImageUrl)}.${extension}`;
          const info = await fileSystemGetInfoAsync(fileUri);
          if (!info.exists) {
            await fileSystemWriteAsStringAsync(fileUri, base64Payload, {
              encoding: fileSystemEncodingTypeBase64,
            });
          }
          if (cancelled) return;
          FOOD_CARD_RENDER_URI_CACHE.set(activeImageUrl, fileUri);
          setRenderableImageUri(fileUri);
          return;
        }

        if (manipulateAsync && ManipulatorSaveFormat) {
          const format = activeImageUrl.startsWith('data:image/png')
            ? ManipulatorSaveFormat.PNG
            : ManipulatorSaveFormat.JPEG;
          const result = await manipulateAsync(
            activeImageUrl,
            [],
            { compress: 1, format, base64: false },
          );
          if (cancelled || !result?.uri) return;
          FOOD_CARD_RENDER_URI_CACHE.set(activeImageUrl, result.uri);
          setRenderableImageUri(result.uri);
          return;
        }

        setRenderableImageUri(activeImageUrl);
      } catch {
        if (!cancelled) {
          setRenderableImageUri(null);
        }
      }
    };

    void materializeInlineImage();
    return () => {
      cancelled = true;
    };
  }, [activeImageUrl]);

  const allergens = Array.isArray(meal.allergens) ? meal.allergens : [];
  const mealDeliveryOptions = meal.deliveryOptions ?? { pickup: true, delivery: false };
  const timeDistanceParts = [
    meal.time,
    mealDeliveryOptions.delivery ? meal.distance : "",
  ].filter((value) => String(value ?? "").trim().length > 0);
  const timeDistanceText = timeDistanceParts.join(" · ");
  const stockSummary = Number.isFinite(meal.stock) && meal.stock > 0
    ? t('status.home.foodCard.lastPortions').replace('{stock}', String(meal.stock))
    : '';
  const photoOverlayColors = derivePhotoOverlayText(photoLightColor, paletteSeed, photoTextTone);
  const hasAllergens = allergens.length > 0;
  const titleMetrics = resolveFoodPhotoTitleMetrics(meal.title);
  const sellerHandle = formatSellerIdentity(meal.seller, meal.sellerUsername);
  const sellerTagline = String(meal.sellerTagline ?? '').trim() || t('status.home.foodCard.sellerTaglineFallback');
  const ratingValue = Number(String(meal.rating ?? '').replace(',', '.'));
  const ratingBadgeText = Number.isFinite(ratingValue)
    ? Number(ratingValue).toFixed(1)
    : '0.0';
  const slideWidth = Math.max(1, imageFrameWidth);
  const sellerInitial = (() => {
    const raw = (meal.sellerUsername || meal.seller || 'U').replace(/^@+/, '').trim();
    if (!raw) return 'U';
    return raw.charAt(0).toLocaleUpperCase('tr-TR');
  })();
  return (
    <View
      style={[
        styles.foodCardWrap,
      ]}
    >
      <View
        style={[
          styles.foodCard,
          { backgroundColor: colors.bg, borderColor: colors.border },
        ]}
      >
        <View
          style={[styles.foodPhoto, { backgroundColor: meal.backgroundColor }]}
          onLayout={(event) => {
            const nextWidth = Math.max(220, Math.round(event.nativeEvent.layout.width));
            const nextHeight = Math.max(120, Math.round(event.nativeEvent.layout.height));
            setImageFrameWidth((prev) => (prev === nextWidth ? prev : nextWidth));
            setImageFrameHeight((prev) => (prev === nextHeight ? prev : nextHeight));
          }}
        >
          {/* Food image slider */}
          {imageUrls.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              style={styles.foodImageCarousel}
              contentContainerStyle={styles.foodImageCarouselContent}
              onMomentumScrollEnd={(event) => {
                const width = Math.max(1, event.nativeEvent.layoutMeasurement.width);
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                const safeIndex = Math.max(0, Math.min(nextIndex, imageUrls.length - 1));
                setImageIndex(safeIndex);
              }}
            >
              {imageUrls.map((uri, idx) => {
                const sourceUri = idx === imageIndex ? (renderableImageUri || uri) : uri;
                return (
                  <View key={`${uri}-${idx}`} style={[styles.foodImageSlide, { width: slideWidth }]}>
                    <Image
                      source={{ uri: sourceUri }}
                      style={styles.foodImage}
                      resizeMode="cover"
                      onError={() => {
                        if (idx === imageIndex && isInlineBase64ImageUri(uri)) {
                          setRenderableImageUri(null);
                        }
                      }}
                    />
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.foodImageFallback} />
          )}
          {LinearGradient ? (
            <View pointerEvents="none" style={styles.foodPhotoBottomGradient}>
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.46)', 'rgba(0,0,0,0.82)']}
                locations={[0, 0.44, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.foodPhotoBottomGradientFill}
              />
            </View>
          ) : (
            <View pointerEvents="none" style={styles.foodPhotoBottomGradientFallback} />
          )}
          {imageUrls.length > 1 ? (
            <View pointerEvents="none" style={styles.foodPhotoDotsRow}>
              {imageUrls.map((_, idx) => (
                <View
                  key={`dot-${idx}`}
                  style={[
                    styles.foodPhotoDot,
                    idx === imageIndex && styles.foodPhotoDotActive,
                  ]}
                />
              ))}
            </View>
          ) : null}
          <View pointerEvents="none" style={styles.foodPhotoTitleOverlay}>
            <Text
              numberOfLines={2}
              style={[
                styles.foodPhotoTitleText,
                titleMetrics,
                photoTextTone === 'dark' && styles.foodPhotoTitleTextDark,
                { color: photoOverlayColors.title },
              ]}
            >
              {meal.title}
            </Text>
            {meal.cuisine ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.foodPhotoCuisineText,
                  photoTextTone === 'dark' && styles.foodPhotoCuisineTextDark,
                  { color: photoOverlayColors.cuisine },
                ]}
              >
                {formatCuisineLabel(meal.cuisine)}
              </Text>
            ) : null}
          </View>
          <View style={styles.foodBadgesRight}>
            <View style={styles.foodPriceBadge}>
              <Text style={styles.foodPriceBadgeText}>{meal.price}</Text>
            </View>
            <View style={styles.foodRatingBadge}>
              <Ionicons name="star" size={14} color="#F2B23A" />
              <Text style={styles.foodRatingBadgeText}>{ratingBadgeText}</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={(event) => {
              event.stopPropagation();
              onFavoritePress();
            }}
            style={[
              styles.foodPhotoFavoriteBtn,
              isFavorite && styles.foodFooterFavoriteBtnActive,
            ]}
            disabled={favoritePending}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color={isFavorite ? '#FFF4F1' : '#FFFDFB'}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.96}
          onPress={onPress}
          style={[
            styles.foodInfo,
            {
              backgroundColor: hexToRgba(colors.bg, 0.95),
              borderTopColor: hexToRgba(colors.border, 0.44),
            },
          ]}
        >
          <View style={styles.foodInfoContent}>
            {/* Row 1: stock info (left) | allergen (right) — equal halves, no divider */}
            <View style={styles.foodInfoMainRow}>
              <View style={styles.foodInfoHalfCol}>
                <View
                  style={[
                    styles.foodInfoIconBubble,
                    { backgroundColor: hexToRgba(colors.meta, 0.16) },
                  ]}
                >
                  <Ionicons name="restaurant-outline" size={16} color={colors.price} />
                </View>
                <View style={[styles.foodInfoTextWrap, styles.foodInfoTextWrapCentered]}>
                  <Text style={styles.foodInfoTitle}>
                    {stockSummary || t('status.home.foodCard.preparingToday')}
                  </Text>
                </View>
              </View>
              <View style={styles.foodInfoHalfCol}>
                <View style={[styles.foodInfoIconBubble, hasAllergens ? styles.foodInfoIconBubbleAlert : styles.foodInfoIconBubbleOk]}>
                  <Ionicons name={hasAllergens ? 'warning-outline' : 'checkmark-circle-outline'} size={16} color={hasAllergens ? '#B13B2E' : '#2F6F4A'} />
                </View>
                <View style={[styles.foodInfoTextWrap, styles.foodInfoTextWrapCentered]}>
                  <Text numberOfLines={1} style={[styles.foodInfoTitle, hasAllergens ? styles.foodInfoAlertTitle : styles.foodInfoOkTitle]}>
                    {hasAllergens ? t('status.home.foodCard.hasAllergens') : t('status.home.foodCard.noAllergens')}
                  </Text>
                </View>
              </View>
            </View>
            {/* Row 2: prep time | short divider | distance — equal halves */}
            <View style={styles.foodStatsRow}>
              <View style={styles.foodInfoHalfCol}>
                <View
                  style={[
                    styles.foodInfoIconBubble,
                    { backgroundColor: hexToRgba(colors.meta, 0.16) },
                  ]}
                >
                  <Ionicons name="time-outline" size={16} color={colors.price} />
                </View>
                <View style={styles.foodInfoTextWrap}>
                  <Text style={styles.foodInfoTitle}>
                    {meal.time || t('status.home.foodCard.timeSoon')}
                  </Text>
                  <Text style={styles.foodInfoSubtitle}>
                    {t('label.home.foodCard.prepTime')}
                  </Text>
                </View>
              </View>
              {mealDeliveryOptions.delivery && String(meal.distance ?? '').trim() ? (
                <>
                  <View style={[styles.foodStatDivider, { backgroundColor: hexToRgba(colors.border, 0.4) }]} />
                  <View style={styles.foodInfoHalfCol}>
                    <View
                      style={[
                        styles.foodInfoIconBubble,
                        { backgroundColor: hexToRgba(colors.meta, 0.16) },
                      ]}
                    >
                      <Ionicons name="location-outline" size={16} color={colors.price} />
                    </View>
                    <View style={styles.foodInfoTextWrap}>
                      <Text style={styles.foodInfoTitle}>
                        {meal.distance}
                      </Text>
                      <Text style={styles.foodInfoSubtitle}>
                        {t('label.home.foodCard.distance')}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
            <View style={[styles.foodFooterRow, { borderTopColor: hexToRgba(colors.border, 0.4) }]}>
              <View style={styles.foodFooterSeller}>
                <View style={styles.foodSellerThumbWrap}>
                  <View style={styles.foodSellerThumb}>
                    {meal.sellerImage && !sellerThumbFailed ? (
                      <Image
                        source={{ uri: meal.sellerImage }}
                        style={styles.foodSellerThumbImage}
                        onError={() => setSellerThumbFailed(true)}
                      />
                    ) : (
                      <View style={styles.foodSellerThumbFallback}>
                        <Text style={[styles.foodSellerThumbFallbackText, { color: colors.price }]}>{sellerInitial}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.foodFooterSellerText}>
                  <Text style={[styles.foodFooterSellerHandle, { color: colors.price }]}>
                    {sellerHandle}
                  </Text>
                  <Text style={[styles.foodFooterSellerTagline, { color: colors.subtitle }]}>
                    {sellerTagline}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  HomeScreen                                                         */
/* ------------------------------------------------------------------ */

export default function HomeScreen({
  auth,
  initialTab,
  onOpenSettings,
  onOpenOrders,
  onOpenComplaints,
  onOpenOrderDetail,
  onOpenPayment,
  onOpenNotifications,
  onOpenChatList,
  onOpenChat,
  onOpenFavorites,
  onOpenFoodDetail,
  onLogout,
  onAuthRefresh,
  onSwitchToSeller,
}: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? 'home');
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [meals, setMeals] = useState<MealCard[]>([]);
  const [mealsLoading, setMealsLoading] = useState(true);
  const [mealsError, setMealsError] = useState<string | null>(null);
  const [inboxMessages, setInboxMessages] =
    useState<ChatMessage[]>(INITIAL_INBOX_MESSAGES);
  const [inboxInput, setInboxInput] = useState('');
  const [messagesWallpaperIndex, setMessagesWallpaperIndex] = useState(0);
  const [selectedMeal, setSelectedMeal] = useState<MealCard | null>(null);
  const [lastCartMealDetail, setLastCartMealDetail] = useState<MealCard | null>(null);
  const [selectedMealAddons, setSelectedMealAddons] = useState<CartItem["selectedAddons"]>({
    free: [],
    paid: [],
  });
  const [mealModalAnimType, setMealModalAnimType] = useState<'slide' | 'none'>('slide');
  const [selectedSeller, setSelectedSeller] = useState<{
    id: string;
    name: string;
    image?: string | null;
  } | null>(null);
  const [sellerModalTouchGuardUntil, setSellerModalTouchGuardUntil] = useState(0);
  const sellerModalSlideX = useRef(new Animated.Value(Dimensions.get('window').width)).current;
  const [sellerReviews, setSellerReviews] = useState<SellerReview[]>([]);
  const [sellerReviewsLoading, setSellerReviewsLoading] = useState(false);
  const [sellerReviewsError, setSellerReviewsError] = useState<string | null>(null);
  const [sellerCompletedMealsSold, setSellerCompletedMealsSold] = useState<number | null>(null);
  const [sellerCompletedMealsLoading, setSellerCompletedMealsLoading] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrderIds, setActiveOrderIds] = useState<string[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [allergenWarnMeal, setAllergenWarnMeal] = useState<MealCard | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusSnapshot | null>(null);
  const [recentBuyerOrders, setRecentBuyerOrders] = useState<HomeOrderSummary[]>([]);
  const [deliveryRequestOrderIds, setDeliveryRequestOrderIds] = useState<Record<string, true>>({});
  const [deliveryRequestStarting, setDeliveryRequestStarting] = useState(false);
  const [deliveryPinModalVisible, setDeliveryPinModalVisible] = useState(false);
  const [deliveryPinOrderId, setDeliveryPinOrderId] = useState<string | null>(null);
  const [deliveryPinRecord, setDeliveryPinRecord] = useState<DeliveryProofRecord | null>(null);
  const [deliveryPinLoading, setDeliveryPinLoading] = useState(false);
  const [deliveryPinError, setDeliveryPinError] = useState<string | null>(null);
  const [cartBottomBarHeight, setCartBottomBarHeight] = useState(DEFAULT_CART_BOTTOM_BAR_HEIGHT);
  const cartPaymentAnimationVisible = false;
  const setCartPaymentAnimationDone = (_value: boolean) => {};
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [cachedLocalImageUrl, setCachedLocalImageUrl] = useState<string | null>(null);
  const [profileImageLoadFailed, setProfileImageLoadFailed] = useState(false);
  const cartToastOpacity = useRef(new Animated.Value(0)).current;
  const cartToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showCartToast() {
    if (cartToastTimeout.current) clearTimeout(cartToastTimeout.current);
    Animated.sequence([
      Animated.timing(cartToastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(cartToastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    cartToastTimeout.current = setTimeout(() => { cartToastOpacity.setValue(0); }, 2000);
  }
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const [profileEditModalVisible, setProfileEditModalVisible] = useState(false);
  const [generalSettingsModalVisible, setGeneralSettingsModalVisible] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [checkoutAddressModalVisible, setCheckoutAddressModalVisible] = useState(false);
  const [userAddresses, setUserAddresses] = useState<UserAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [selectedCheckoutAddressId, setSelectedCheckoutAddressId] = useState<string | null>(null);
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'pickup'>('pickup');
  const [pickupSellerAddress, setPickupSellerAddress] = useState<{ title?: string; addressLine?: string } | null>(null);
  const [pickupSellerAddressLoading, setPickupSellerAddressLoading] = useState(false);
  const [pickupSellerAddressError, setPickupSellerAddressError] = useState<string | null>(null);
  const [appLanguage, setAppLanguage] = useState<AppSettings['language']>('tr');

  useEffect(() => {
    if (deliveryType !== 'pickup' || cartItems.length === 0) {
      setPickupSellerAddress(null);
      setPickupSellerAddressLoading(false);
      setPickupSellerAddressError(null);
      return;
    }
    const sellerId = cartItems[0].meal.sellerId;
    if (!sellerId) {
      setPickupSellerAddress(null);
      setPickupSellerAddressLoading(false);
      setPickupSellerAddressError(t('helper.home.flowSellerMissing'));
      return;
    }
    const sellerIds = [...new Set(cartItems.map((ci) => ci.meal.sellerId))];
    if (sellerIds.length !== 1) {
      setPickupSellerAddress(null);
      setPickupSellerAddressLoading(false);
      setPickupSellerAddressError('Gel al için sepette tek satıcı olmalı.');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPickupSellerAddressLoading(true);
    setPickupSellerAddressError(null);
    loadSettings()
      .then(async (settings) => {
        const effectiveApiUrl = settings.apiUrl || apiUrl;
        const timeoutId = setTimeout(() => controller.abort(), PICKUP_ADDRESS_REQUEST_TIMEOUT_MS);
        try {
          const response = await authedJsonFetch(`${effectiveApiUrl}/v1/foods/sellers/${sellerId}/address`, {
            headers: {
              'x-actor-role': 'buyer',
            },
            signal: controller.signal,
          });
          const json = await readJsonSafe<{ data?: { title?: string; addressLine?: string } | null; error?: { message?: string } }>(response);
          if (!response.ok) {
            throw new Error(json?.error?.message ?? requestErrorLine(response.status));
          }
          return json;
        } finally {
          clearTimeout(timeoutId);
        }
      })
      .then((json) => {
        if (cancelled) return;
        const nextAddress = json?.data ?? null;
        setPickupSellerAddress(nextAddress);
        if (!nextAddress?.title && !nextAddress?.addressLine) {
          setPickupSellerAddressError(t('helper.home.pickupAddressMissing'));
        } else {
          setPickupSellerAddressError(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPickupSellerAddress(null);
        if (error instanceof Error && error.name === 'AbortError') {
          setPickupSellerAddressError(t('error.home.pickupAddressFailed'));
          return;
        }
        setPickupSellerAddressError(normalizeHomeRequestError(error, 'error.home.pickupAddressFailed'));
      })
      .finally(() => {
        if (cancelled) return;
        setPickupSellerAddressLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [deliveryType, cartItems, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSettings().then((settings) => setAppLanguage(settings.language));
    return subscribeSettings((settings) => setAppLanguage(settings.language));
  }, []);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [selectedLocationLabel, setSelectedLocationLabel] = useState(() => `Kadıköy • 2.5 km ${t('helper.home.locationRadius')}`);
  const [headerImageSource, setHeaderImageSource] = useState<ImageSourcePropType>(LOCAL_HOME_HEADER_FALLBACK);
  const [adminHeroImageUrl, setAdminHeroImageUrl] = useState<string | null>(null);
  const [heroImageResolved, setHeroImageResolved] = useState(false);
  const [heroColors, setHeroColors] = useState<HeroColors>(() => deriveHeroColors(DEFAULT_HERO_SEED));
  const [profileDisplayName, setProfileDisplayName] = useState<string>(() =>
    resolveProfileDisplayName(null, auth.email),
  );
  const [greetingName, setGreetingName] = useState<string>(() =>
    resolveGreetingName(null, auth.email),
  );
  const [greetingSubtitle, setGreetingSubtitle] = useState<string>(() =>
    randomHomeGreetingSubtitle(),
  );
  const [dynamicGreetingTitle, setDynamicGreetingTitle] = useState(() =>
    buildGreetingTitle(resolveGreetingName(null, auth.email)),
  );
  const [sloganTrackWidth, setSloganTrackWidth] = useState(0);
  const [sloganTextWidth, setSloganTextWidth] = useState(0);
  const [foodSectionOffsetY, setFoodSectionOffsetY] = useState(0);
  const [recommendedMeals, setRecommendedMeals] = useState<RecommendationMeal[]>([]);
  const [recommendedMealsLoading, setRecommendedMealsLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Record<string, true>>({});
  const [favoritePendingIds, setFavoritePendingIds] = useState<Record<string, true>>({});
  const [scrollSurfaceBg, setScrollSurfaceBg] = useState('#FDDEB7');
  const scrollSurfaceBgRef = useRef('#FDDEB7');
  const overscrollZoneRef = useRef<'none' | 'top' | 'bottom'>('none');
  const showSloganCard = false;
  const mealsMarqueeText = useMemo(
    () => DAILY_FLASH_MEALS.join(' • '),
    [],
  );
  const defaultAddress = useMemo(
    () => userAddresses.find((item) => item.isDefault) ?? null,
    [userAddresses],
  );
  const authSnapshot = useMemo<AuthSession>(() => ({
    accessToken: currentAuth.accessToken,
    refreshToken: currentAuth.refreshToken,
    userId: currentAuth.userId,
    userType: currentAuth.userType,
    email: currentAuth.email,
  }), [
    currentAuth.accessToken,
    currentAuth.refreshToken,
    currentAuth.userId,
    currentAuth.userType,
    currentAuth.email,
  ]);

  useEffect(() => {
    setSelectedMealAddons({ free: [], paid: [] });
  }, [selectedMeal?.id]);
  const selectedCheckoutAddress = useMemo(() => {
    if (selectedCheckoutAddressId) {
      return userAddresses.find((item) => item.id === selectedCheckoutAddressId) ?? defaultAddress;
    }
    return defaultAddress;
  }, [defaultAddress, selectedCheckoutAddressId, userAddresses]);
  const cartSupportedDeliveryOptions = useMemo(() => {
    if (cartItems.length === 0) {
      return { pickup: true, delivery: true };
    }
    let pickup = true;
    let delivery = true;
    for (const item of cartItems) {
      const options = item.meal.deliveryOptions ?? { pickup: true, delivery: false };
      pickup = pickup && options.pickup;
      delivery = delivery && options.delivery;
    }
    if (!pickup && !delivery) {
      return { pickup: true, delivery: false };
    }
    return { pickup, delivery };
  }, [cartItems]);
  const fallbackRecommendedMeals = useMemo<RecommendationMeal[]>(
    () =>
      meals.slice(0, 8).map((meal) => ({
        ...meal,
        reason: 'Öneri',
      })),
    [meals],
  );
  const visibleRecommendedMeals = useMemo<RecommendationMeal[]>(
    () => (recommendedMeals.length > 0 ? recommendedMeals : fallbackRecommendedMeals),
    [recommendedMeals, fallbackRecommendedMeals],
  );
  const actionableHomeOrders = useMemo<HomeOrderSummary[]>(() => {
    const sortedOrders = [...recentBuyerOrders].sort((a, b) => homeOrderTime(b) - homeOrderTime(a));
    const mappedActionable = sortedOrders.filter((order) => isHomeActionableOrderStatus(order.status));

    const fallbackOrderId = paymentStatus?.orderId || activeOrderIds[0] || activeOrderId;
    if (!fallbackOrderId) return mappedActionable;

    const fallbackStatus = paymentStatus?.orderStatus || 'pending_seller_approval';
    if (!isHomeActionableOrderStatus(fallbackStatus)) return mappedActionable;

    const hasFallbackAlready = mappedActionable.some((order) => order.id === fallbackOrderId);
    if (hasFallbackAlready) return mappedActionable;

    return [
      {
        id: fallbackOrderId,
        orderNo: null,
        status: fallbackStatus,
        sellerName: t('status.orders.sellerFallback'),
        items: [],
        totalPrice: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deliveryType: 'pickup',
        requestedDeliveryType: 'pickup',
        activeDeliveryType: 'pickup',
        sellerDecisionState: null,
      },
      ...mappedActionable,
    ];
  }, [activeOrderId, activeOrderIds, paymentStatus, recentBuyerOrders]);
  const showHomeOrderPromo = actionableHomeOrders.length > 0;
  const latestActionableHomeOrder = actionableHomeOrders[0] ?? null;
  const hideCartQuickOrderCard = shouldHideCartQuickOrderCard(latestActionableHomeOrder);
  const showCartQuickOrderCard =
    cartItems.length === 0 && actionableHomeOrders.length > 0 && !hideCartQuickOrderCard;
  const shouldShowQuickOrderRefresh = useCallback((orderId: string) => Boolean(
    paymentLoading ||
    paymentStatus?.orderId === orderId ||
    activeOrderId === orderId ||
    activeOrderIds.includes(orderId)
  ), [activeOrderId, activeOrderIds, paymentLoading, paymentStatus?.orderId]);

  // FAB animations
  const breatheScale = useRef(new Animated.Value(1)).current;
  const sloganMarqueeX = useRef(new Animated.Value(0)).current;
  const sloganMarqueeLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const feedScrollRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const mealsLoadedOnceRef = useRef(false);
  const recommendedMealsLoadedOnceRef = useRef(false);
  const buyerFeedRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buyerOrdersRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buyerOrdersPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoOpenedPaymentOrderIdsRef = useRef<Set<string>>(new Set());
  const autoOpenedDeliveryPinOrderIdsRef = useRef<Set<string>>(new Set());
  // Always-current auth ref — avoids stale closures without triggering re-renders.
  const currentAuthRef = useRef<AuthSession>(currentAuth);
  useEffect(() => { currentAuthRef.current = currentAuth; });

  useEffect(() => {
    setCurrentAuth((prev) => (areAuthSessionsEqual(prev, auth) ? prev : auth));
  }, [auth.accessToken, auth.refreshToken, auth.userId, auth.userType, auth.email]);

  const handleAuthRefresh = useCallback((session: AuthSession) => {
    setCurrentAuth((prev) => (areAuthSessionsEqual(prev, session) ? prev : session));
    onAuthRefresh?.(session);
  }, [onAuthRefresh]);

  // Stable callback — reads auth from ref so it never needs to be recreated on
  // token refresh, which would cascade into a useEffect re-fire loop.
  const fetchRecentBuyerOrders = useCallback(async () => {
    const auth = currentAuthRef.current;
    let result = await apiRequest<HomeOrdersApiItem[]>(
      '/v1/orders/?pageSize=100&sortDir=desc&role=buyer',
      auth,
      { actorRole: 'buyer' },
      handleAuthRefresh,
    );

    if (!result.ok) {
      result = await apiRequest<HomeOrdersApiItem[]>(
        '/v1/orders/?page=1&pageSize=100&sortDir=desc&role=buyer',
        auth,
        { actorRole: 'buyer' },
        handleAuthRefresh,
      );
    }

    if (!result.ok) return;

    const mapped: HomeOrderSummary[] = (Array.isArray(result.data) ? result.data : []).map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      sellerName: (order.sellerName ?? t('status.orders.sellerFallback')).trim() || t('status.orders.sellerFallback'),
      items: Array.isArray(order.items) ? order.items.map((item) => ({ name: item.name, quantity: item.quantity })) : [],
      totalPrice: Number(order.totalPrice ?? 0),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      deliveryType: order.deliveryType === 'delivery' ? 'delivery' : 'pickup',
      requestedDeliveryType: order.requestedDeliveryType === 'delivery' ? 'delivery' : 'pickup',
      activeDeliveryType: order.activeDeliveryType === 'delivery' ? 'delivery' : (order.deliveryType === 'delivery' ? 'delivery' : 'pickup'),
      sellerDecisionState: order.sellerDecisionState ?? null,
      lastSellerNote: order.lastSellerNote ?? null,
    }));

    setRecentBuyerOrders(mapped);
  }, [handleAuthRefresh]); // handleAuthRefresh is stable (depends only on onAuthRefresh=setAuth)

  const fetchDeliveryProof = useCallback(async (orderId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setDeliveryPinLoading(true);
      setDeliveryPinError(null);
    }
    const result = await apiRequest<DeliveryProofRecord>(
      `/v1/orders/${orderId}/delivery-proof`,
      currentAuthRef.current,
      { actorRole: 'buyer' },
      handleAuthRefresh,
    );
    if (result.ok) {
      setDeliveryPinRecord(result.data);
      setDeliveryPinOrderId(orderId);
      setDeliveryPinError(null);
    } else if (result.status === 404 || result.status === 403) {
      setDeliveryPinRecord(null);
      setDeliveryPinOrderId(orderId);
      if (!silent) setDeliveryPinError(null);
    } else if (!silent) {
      setDeliveryPinError(result.message ?? t('status.deliveryPin.loading'));
    }
    if (!silent) setDeliveryPinLoading(false);
  }, [handleAuthRefresh]);

  const requestDeliveryForOrder = useCallback(async (order: HomeOrderSummary) => {
    if (!canRequestBuyerDelivery(order) || deliveryRequestOrderIds[order.id]) return;
    setDeliveryRequestOrderIds((prev) => ({ ...prev, [order.id]: true }));
    try {
      const response = await authedJsonFetch(`${apiUrl}/v1/orders/${order.id}/buyer-delivery-request`, {
        method: 'POST',
        headers: {
          'x-actor-role': 'buyer',
        },
        body: JSON.stringify({ requestedDeliveryType: 'delivery' }),
      });
      const json = await readJsonSafe<{
        error?: { message?: string };
      }>(response);
      if (!response.ok) {
        throw new Error(json?.error?.message ?? t('error.home.deliveryRequestFailed'));
      }

      setRecentBuyerOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, requestedDeliveryType: 'delivery' }
          : item
      )));
      setPaymentInfo(t('helper.home.deliveryRequestSuccess'));
      Alert.alert(t('headline.common.saved'), t('helper.home.deliveryRequestSuccess'));
    } catch (error) {
      Alert.alert(
        t('headline.common.error'),
        error instanceof Error ? error.message : t('error.home.deliveryRequestFailed'),
      );
    } finally {
      setDeliveryRequestOrderIds((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      void fetchRecentBuyerOrders();
    }
  }, [apiUrl, deliveryRequestOrderIds, fetchRecentBuyerOrders]);

  async function createPickupOrdersFromCart(options?: { requireSingleSeller?: boolean }): Promise<{
    createdOrderIds: string[];
    firstCreatedStatus: string;
    effectiveApiUrl: string;
  }> {
    if (cartItems.length === 0) {
      throw new Error(t('helper.home.cartEmptyAlertMessage'));
    }

    const { apiUrl: settingsApiUrl } = await loadSettings();
    const effectiveApiUrl = settingsApiUrl || apiUrl;
    if (!effectiveApiUrl || effectiveApiUrl === 'http://localhost:3000') {
      throw new Error(t('error.home.checkoutStartFailed'));
    }
    if (effectiveApiUrl !== apiUrl) {
      setApiUrl(effectiveApiUrl);
    }

    const resolvedCartItems = cartItems.map((item) => {
      if (item.meal.lotId) return item;
      const matchedMeal = meals.find((m) => m.id === item.meal.id);
      return {
        ...item,
        meal: {
          ...item.meal,
          lotId: matchedMeal?.lotId ?? null,
        },
      };
    });

    const payableItems = resolvedCartItems.filter((item) => item.meal.lotId);
    const missingItems = resolvedCartItems.filter((item) => !item.meal.lotId);
    if (missingItems.length > 0) {
      setCartItems(payableItems);
    }
    if (payableItems.length === 0) {
      throw new Error(t('error.home.payableLotsMissing'));
    }

    const groupedBySeller = new Map<string, CartItem[]>();
    for (const item of payableItems) {
      const sellerId = item.meal.sellerId;
      if (!sellerId) {
        throw new Error(t('helper.home.flowSellerMissing'));
      }
      const existing = groupedBySeller.get(sellerId) ?? [];
      groupedBySeller.set(sellerId, [...existing, item]);
    }

    if (options?.requireSingleSeller && groupedBySeller.size !== 1) {
      throw new Error(t('error.home.deliveryChatSellerRequired'));
    }

    const createdOrderIds: string[] = [];
    let firstCreatedStatus = 'pending_seller_approval';
    for (const [sellerId, sellerItems] of groupedBySeller.entries()) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_REQUEST_TIMEOUT_MS);
      let orderRes: Response;
      try {
        orderRes = await authedJsonFetch(`${effectiveApiUrl}/v1/orders/`, {
          method: 'POST',
          headers: {
            'x-actor-role': 'buyer',
            'Idempotency-Key': `mobile-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          },
          body: JSON.stringify({
            sellerId,
            deliveryType: 'pickup',
            items: sellerItems.map((item) => ({
              lotId: item.meal.lotId,
              quantity: item.quantity,
              selectedAddons: item.selectedAddons,
            })),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(t('error.home.checkoutCreateFailed'));
        }
        throw new Error(t('error.home.checkoutStartFailed'));
      }
      clearTimeout(timeoutId);
      const orderJson = await readJsonSafe<{
        data?: { orderId?: string; status?: string };
        error?: { message?: string };
      }>(orderRes);
      if (!orderRes.ok) {
        throw new Error(t('error.home.checkoutCreateFailed'));
      }
      const orderId = String(orderJson?.data?.orderId ?? '');
      if (!orderId) {
        throw new Error(t('error.home.checkoutMissingOrderId'));
      }
      if (createdOrderIds.length === 0) {
        firstCreatedStatus = String(orderJson?.data?.status ?? 'pending_seller_approval');
      }
      createdOrderIds.push(orderId);
    }

    return { createdOrderIds, firstCreatedStatus, effectiveApiUrl };
  }

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  useEffect(() => {
    if (activeTab !== 'home' && activeTab !== 'cart') return;
    void fetchRecentBuyerOrders();
  }, [activeTab, fetchRecentBuyerOrders]);

  useEffect(() => {
    const atDoorOrder = actionableHomeOrders.find((order) => String(order.status ?? '').trim().toLowerCase() === 'at_door');
    if (!atDoorOrder) {
      if (deliveryPinOrderId && !actionableHomeOrders.some((order) => order.id === deliveryPinOrderId)) {
        setDeliveryPinModalVisible(false);
        setDeliveryPinOrderId(null);
        setDeliveryPinRecord(null);
        setDeliveryPinError(null);
      }
      return;
    }
    if (activeTab !== 'home') return;
    if (autoOpenedDeliveryPinOrderIdsRef.current.has(atDoorOrder.id)) return;
    autoOpenedDeliveryPinOrderIdsRef.current.add(atDoorOrder.id);
    setDeliveryPinModalVisible(true);
    void fetchDeliveryProof(atDoorOrder.id);
  }, [actionableHomeOrders, activeTab, deliveryPinOrderId, fetchDeliveryProof]);

  useEffect(() => {
    if (!deliveryPinModalVisible || !deliveryPinOrderId) return () => {};
    if (deliveryPinRecord?.status === 'verified') {
      setDeliveryPinModalVisible(false);
      void fetchRecentBuyerOrders();
      return () => {};
    }
    const interval = setInterval(() => {
      void fetchDeliveryProof(deliveryPinOrderId, { silent: true });
      void fetchRecentBuyerOrders();
    }, 3_000);
    return () => clearInterval(interval);
  }, [deliveryPinModalVisible, deliveryPinOrderId, deliveryPinRecord?.status, fetchDeliveryProof, fetchRecentBuyerOrders]);

  useEffect(() => {
    if (!onOpenPayment) return;

    const currentOrderIds = new Set(actionableHomeOrders.map((order) => order.id));
    autoOpenedPaymentOrderIdsRef.current.forEach((orderId) => {
      if (!currentOrderIds.has(orderId)) {
        autoOpenedPaymentOrderIdsRef.current.delete(orderId);
      }
    });

    const targetOrder = actionableHomeOrders.find(canAutoOpenBuyerPickupPayment);
    if (!targetOrder) return;
    if (autoOpenedPaymentOrderIdsRef.current.has(targetOrder.id)) return;

    autoOpenedPaymentOrderIdsRef.current.add(targetOrder.id);
    onOpenPayment(targetOrder.id);
  }, [actionableHomeOrders, onOpenPayment]);

  useEffect(() => {
    loadCachedProfileImageUrl().then((cached) => {
      if (!cached) return;
      setCachedLocalImageUrl(cached);
    });
  }, []);

  useEffect(() => {
    setProfileImageLoadFailed(false);
  }, [profileImageUrl]);

  useEffect(() => {
    if (!apiUrl) return;
    void fetchMeProfile(apiUrl, currentAuth.accessToken);
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!apiUrl) return;
    void fetchUserAddresses();
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedCheckoutAddressId) return;
    const exists = userAddresses.some((item) => item.id === selectedCheckoutAddressId);
    if (!exists) setSelectedCheckoutAddressId(null);
  }, [selectedCheckoutAddressId, userAddresses]);

  useEffect(() => {
    if (cartItems.length === 0) return;
    if (deliveryType === 'delivery' && !cartSupportedDeliveryOptions.delivery) {
      setDeliveryType('pickup');
      return;
    }
    if (deliveryType === 'pickup' && !cartSupportedDeliveryOptions.pickup) {
      setDeliveryType('delivery');
    }
  }, [cartItems.length, cartSupportedDeliveryOptions.delivery, cartSupportedDeliveryOptions.pickup, deliveryType]);

  useEffect(() => {
    if (!heroImageResolved) {
      setHeaderImageSource(LOCAL_HOME_HEADER_FALLBACK);
      return;
    }

    const heroCandidate = !adminHeroImageUrl
      ? meals.find((meal) => {
          const normalized = normalizeDishText(meal.title ?? '');
          const hasImage = Boolean(meal.imageUrl && meal.imageUrl.trim());
          const isAkcaabat = normalized.includes('akcabat') && normalized.includes('kofte');
          return hasImage && !isAkcaabat;
        })
      : null;

    const heroUrl = adminHeroImageUrl || heroCandidate?.imageUrl?.trim();
    if (!heroUrl) {
      setHeaderImageSource(LOCAL_HOME_HEADER_FALLBACK);
      return;
    }
    setHeaderImageSource({ uri: heroUrl });

    if (getColors) {
      getColors(heroUrl, { fallback: DEFAULT_HERO_SEED, cache: true, key: `hero:${heroUrl}` })
        .then((result) => {
          const seed = pickImagePaletteColor(result, DEFAULT_HERO_SEED);
          setHeroColors(deriveHeroColors(seed));
        })
        .catch(() => {});
    }
  }, [adminHeroImageUrl, meals, heroImageResolved]);

  useEffect(() => {
    setGreetingName(resolveGreetingName(null, currentAuth.email));
  }, [currentAuth.email]);

  useEffect(() => {
    const refreshGreeting = () => setDynamicGreetingTitle(buildGreetingTitle(greetingName));
    refreshGreeting();
    const interval = setInterval(refreshGreeting, 60_000);
    return () => clearInterval(interval);
  }, [greetingName, appLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refreshSubtitle = () => setGreetingSubtitle(randomHomeGreetingSubtitle());
    refreshSubtitle();
    const interval = setInterval(refreshSubtitle, 15 * 60_000);
    return () => clearInterval(interval);
  }, [appLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sloganTrackWidth || !sloganTextWidth) return;

    sloganMarqueeLoopRef.current?.stop();
    sloganMarqueeX.setValue(0);

    const cycle = sloganTextWidth + SLOGAN_MARQUEE_GAP;
    const duration = Math.max(5000, Math.round((cycle / 34) * 1000));
    const loop = Animated.loop(
      Animated.timing(sloganMarqueeX, {
        toValue: -cycle,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    sloganMarqueeLoopRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
    };
  }, [sloganMarqueeX, sloganTextWidth, sloganTrackWidth]);

  // Fetch foods from API — authedJsonFetch handles token refresh internally,
  // no need to re-run this on every access token change.
  useEffect(() => {
    if (!apiUrl || apiUrl === 'http://localhost:3000') {
      // Wait until apiUrl is loaded from settings
      loadSettings().then((s) => {
        if (s.apiUrl) fetchFoods(s.apiUrl);
      });
      return;
    }
    fetchFoods(apiUrl, { silent: mealsLoadedOnceRef.current });
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh feed every time user returns to home tab (e.g. after publishing from seller side)
  useEffect(() => {
    if (activeTab !== 'home') return;
    if (!apiUrl) return;
    fetchFoods(apiUrl, { silent: true });
  }, [activeTab, apiUrl]);

  // Refresh feed when app comes back from background while home is open.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (activeTab !== 'home') return;
      if (!apiUrl) return;
      fetchFoods(apiUrl, { silent: true });
    });
    return () => sub.remove();
  }, [activeTab, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep home feed fresh while app stays open on Home.
  useEffect(() => {
    if (activeTab !== 'home' || !apiUrl) return;
    const id = setInterval(() => {
      fetchFoods(apiUrl, { silent: true });
    }, 15000);
    return () => clearInterval(id);
  }, [activeTab, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== 'home' || !apiUrl) return;
    const unsubscribe = subscribeBuyerFeedRealtime(() => {
      if (buyerFeedRefreshTimerRef.current) return;
      buyerFeedRefreshTimerRef.current = setTimeout(() => {
        buyerFeedRefreshTimerRef.current = null;
        void fetchFoods(apiUrl, { silent: true });
      }, 1200);
    });
    return () => {
      if (buyerFeedRefreshTimerRef.current) {
        clearTimeout(buyerFeedRefreshTimerRef.current);
        buyerFeedRefreshTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [activeTab, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh home order card in real time when seller responds.
  useEffect(() => {
    const buyerId = currentAuthRef.current?.userId;
    if ((activeTab !== 'home' && activeTab !== 'cart') || !buyerId) return;
    const unsubscribe = subscribeBuyerOrdersRealtime(buyerId, () => {
      if (buyerOrdersRefreshTimerRef.current) return;
      buyerOrdersRefreshTimerRef.current = setTimeout(() => {
        buyerOrdersRefreshTimerRef.current = null;
        void fetchRecentBuyerOrders();
      }, 800);
    });
    return () => {
      if (buyerOrdersRefreshTimerRef.current) {
        clearTimeout(buyerOrdersRefreshTimerRef.current);
        buyerOrdersRefreshTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [activeTab, fetchRecentBuyerOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll order statuses periodically when active orders exist.
  // Realtime subscription uses buyer_id filter which may not match UPDATE events
  // if the orders table lacks REPLICA IDENTITY FULL — polling ensures status
  // changes from the seller (ready, in_delivery, approaching, at_door) are picked up.
  useEffect(() => {
    const hasActiveTab = activeTab === 'home' || activeTab === 'cart';
    const hasOrders = actionableHomeOrders.length > 0;
    if (!hasActiveTab || !hasOrders) {
      if (buyerOrdersPollRef.current) {
        clearInterval(buyerOrdersPollRef.current);
        buyerOrdersPollRef.current = null;
      }
      return;
    }
    if (buyerOrdersPollRef.current) return; // already polling
    buyerOrdersPollRef.current = setInterval(() => {
      void fetchRecentBuyerOrders();
    }, 2_000);
    return () => {
      if (buyerOrdersPollRef.current) {
        clearInterval(buyerOrdersPollRef.current);
        buyerOrdersPollRef.current = null;
      }
    };
  }, [activeTab, actionableHomeOrders.length, fetchRecentBuyerOrders]);

  useEffect(() => {
    let cancelled = false;
    const showLoading = !recommendedMealsLoadedOnceRef.current;
    if (showLoading) setRecommendedMealsLoading(true);
    apiRequest<ApiRecommendationItem[]>(
      '/v1/foods/recommendations?limit=8',
      authSnapshot,
      { actorRole: 'buyer' },
      handleAuthRefresh,
    )
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          if (!recommendedMealsLoadedOnceRef.current) {
            setRecommendedMeals([]);
          }
          return;
        }
        const mapped = (Array.isArray(result.data) ? result.data : []).map((item) => ({
          ...apiToMealCard(item),
          reason: (item.reason ?? 'Sana uygun bir öneri').trim(),
        }));
        setRecommendedMeals(mapped);
      })
      .finally(() => {
        if (cancelled) return;
        recommendedMealsLoadedOnceRef.current = true;
        if (showLoading) setRecommendedMealsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authSnapshot.accessToken) return;
    let cancelled = false;

    async function fetchFavoriteIds() {
      const result = await apiRequest<FavoriteFoodItem[]>(
        '/v1/favorites',
        authSnapshot,
        { actorRole: 'buyer' },
        handleAuthRefresh,
      );
      if (!result.ok || cancelled) return;

      const nextIds: Record<string, true> = {};
      for (const item of result.data ?? []) {
        if (item?.id) nextIds[item.id] = true;
      }
      setFavoriteIds(nextIds);
    }

    void fetchFavoriteIds();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFavorite = useCallback(async (foodId: string) => {
    if (!foodId || favoritePendingIds[foodId]) return;

    const wasFavorite = Boolean(favoriteIds[foodId]);
    setFavoritePendingIds((prev) => ({ ...prev, [foodId]: true }));
    setFavoriteIds((prev) => {
      const next = { ...prev };
      if (wasFavorite) {
        delete next[foodId];
      } else {
        next[foodId] = true;
      }
      return next;
    });

    const result = await apiRequest(
      `/v1/favorites/${foodId}`,
      authSnapshot,
      { method: wasFavorite ? 'DELETE' : 'POST', actorRole: 'buyer' },
      handleAuthRefresh,
    );

    if (!result.ok) {
      setFavoriteIds((prev) => {
        const next = { ...prev };
        if (wasFavorite) next[foodId] = true;
        else delete next[foodId];
        return next;
      });
      Alert.alert(t('headline.common.error'), t('error.home.favoriteUpdateFailed'));
    }

    setFavoritePendingIds((prev) => {
      const next = { ...prev };
      delete next[foodId];
      return next;
    });
  }, [authSnapshot, favoriteIds, favoritePendingIds, handleAuthRefresh]);

  async function fetchFoods(url: string, options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent) && mealsLoadedOnceRef.current;
    if (!silent) {
      setMealsLoading(true);
      setMealsError(null);
    }
    try {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
          const response = await authedJsonFetch(`${url}/v1/foods/`, {
            headers: {
              'x-actor-role': 'buyer',
            },
        });
        const json = await readJsonSafe<{
          data?: ApiFoodItem[];
          error?: { message?: string };
        }>(response);

        if (response.ok) {
          setAdminHeroImageUrl(resolveHomeHeaderImageUrl(json));
          setHeroImageResolved(true);
          if (!Array.isArray(json.data)) {
            if (!silent) setMealsError(t('error.home.noMealsInResponse'));
            return;
          }
          setMeals(json.data.map(apiToMealCard));
          setMealsError(null);
          mealsLoadedOnceRef.current = true;
          return;
        }

        if (response.status === 401) {
          if (!silent) setMealsError(t('error.home.sessionExpired'));
          return;
        }

        if (shouldRetryTransientStatus(response.status) && attempt < maxRetries - 1) {
          await sleep(500 * (attempt + 1));
          continue;
        }

        if (!silent) {
          setMealsError(
            json?.error?.message && !isAuthErrorMessage(json.error.message)
              ? json.error.message
              : humanizeHttpError(response.status),
          );
        }
        return;
      }

      if (!silent) setMealsError(t('error.home.retryLater'));
    } catch (err) {
      if (!silent) setMealsError(normalizeHomeRequestError(err, 'error.home.requestFailed'));
    } finally {
      if (!silent) setMealsLoading(false);
    }
  }

  async function fetchMeProfile(url: string, accessToken: string) {
    try {
      const response = await authedJsonFetch(`${url}/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) return;
      const json = await readJsonSafe<{ data?: MeProfile }>(response);
      const imageUrl = json.data?.profileImageUrl ?? null;
      setProfileImageUrl(imageUrl);
      if (imageUrl) saveCachedProfileImageUrl(imageUrl);
      setGreetingName(resolveGreetingName(json.data, currentAuth.email));
      setProfileDisplayName(resolveProfileDisplayName(json.data, currentAuth.email));
    } catch {
      // Keep fallback avatar when profile fetch fails
    }
  }

  async function authedJsonFetch(url: string, options?: RequestInit) {
    const requestWithToken = async (token: string) =>
      fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options?.headers ?? {}),
        },
      });

    let response = await requestWithToken(currentAuth.accessToken);
    if (response.status !== 401) return response;

    // Always use a freshly-loaded API URL for the refresh call so a stale closure
    // value (e.g. 'http://localhost:3000' during app startup) never causes the
    // refresh request to hang or connect to the wrong host.
    const { apiUrl: fallbackApiUrl } = await loadSettings();
    const refreshed = await refreshAuthSession(
      resolveRefreshBaseUrlFromRequest(url, fallbackApiUrl),
      currentAuth,
    );
    if (!refreshed) return response;

    handleAuthRefresh(refreshed);
    response = await requestWithToken(refreshed.accessToken);
    return response;
  }

  function formatAddressLine(address: UserAddress | null): string {
    if (!address) return t('helper.home.noDefaultAddress');
    const line = address.addressLine.trim();
    const shortLine = line.length > 52 ? `${line.slice(0, 52).trimEnd()}...` : line;
    return `${address.title} • ${shortLine}`;
  }

  async function fetchUserAddresses() {
    setAddressesLoading(true);
    try {
      const response = await authedJsonFetch(`${apiUrl}/v1/auth/me/addresses`);
      const json = await readJsonSafe<{ data?: UserAddress[]; error?: { message?: string } }>(response);
      if (!response.ok || json.error) {
        throw new Error(json.error?.message ?? `Adresler alınamadı (${response.status})`);
      }
      setUserAddresses(Array.isArray(json.data) ? json.data : []);
    } catch {
      setUserAddresses([]);
    } finally {
      setAddressesLoading(false);
    }
  }

  async function handleProfileAvatarPress() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('helper.profileEdit.permissionTitle'), t('helper.profileEdit.permissionMessage'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.55,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const uri = asset.uri;
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const base64Image = asset.base64 ?? null;

      setProfileImageUrl(uri);
      setCachedLocalImageUrl(uri);
      await saveCachedProfileImageUrl(uri);

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        Alert.alert(t('headline.common.error'), t('error.profileEdit.imageType'));
        return;
      }

      setProfileImageUploading(true);
      const baseUrl = apiUrl || (await loadSettings()).apiUrl;

      if (!base64Image) {
        throw new Error('Resim verisi alınamadı. Lütfen farklı bir görsel seç.');
      }

      const directRes = await authedJsonFetch(`${baseUrl}/v1/auth/me/profile-image/upload`, {
        method: 'POST',
        body: JSON.stringify({
          contentType: mimeType,
          dataBase64: base64Image,
        }),
      });
      const directJson = await readJsonSafe<{
        data?: { profileImageUrl?: string };
        error?: { message?: string };
      }>(directRes);
      if (!directRes.ok || directJson.error) {
        throw new Error(directJson.error?.message ?? 'Profil resmi şu an yüklenemedi');
      }
      const uploadedImageUrl = String(directJson?.data?.profileImageUrl ?? uri);

      setProfileImageUrl(uploadedImageUrl);
      await saveCachedProfileImageUrl(uploadedImageUrl);
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.profileEdit.imageUpload'));
    } finally {
      setProfileImageUploading(false);
    }
  }

  // FAB pulse & breathe animations
  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          isInteraction: false,
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: 0.92,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          isInteraction: false,
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          isInteraction: false,
          useNativeDriver: true,
        }),
      ]),
    );

    breathe.start();

    return () => {
      breathe.stop();
    };
  }, [breatheScale]);

  useEffect(() => {
    if (searchMode) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [searchMode]);

  function handleFabPress() {
    setActiveTab('messages');
  }

  function handleInboxSend() {
    const text = inboxInput.trim();
    if (!text) return;
    setInboxMessages((prev) => [
      ...prev,
      { id: `inbox-${Date.now()}`, text, isUser: true },
    ]);
    setInboxInput('');
  }

  function handleWallpaperSwitch() {
    setMessagesWallpaperIndex((prev) => (prev + 1) % MESSAGE_WALLPAPERS.length);
  }

  function applyLocationSelection(type: 'current' | 'home' | 'work' | 'new') {
    const radius = t('helper.home.locationRadius');
    if (type === 'current') {
      setSelectedLocationLabel(`Kadıköy • 2.5 km ${radius}`);
      setNearbyOnly(true);
    } else if (type === 'home') {
      setSelectedLocationLabel(`Ev • 4.0 km ${radius}`);
      setNearbyOnly(false);
    } else if (type === 'work') {
      setSelectedLocationLabel(`İş • 3.0 km ${radius}`);
      setNearbyOnly(false);
    } else {
      setSelectedLocationLabel(`Yeni adres • 5.0 km ${radius}`);
      setNearbyOnly(false);
    }
    setLocationModalVisible(false);
  }

  function doAddMealToCart(
    meal: MealCard,
    selectedAddons: CartItem["selectedAddons"] = { free: [], paid: [] },
  ) {
    setActiveOrderId(null);
    setActiveOrderIds([]);
    setPaymentError(null);
    setPaymentInfo(null);
    setPaymentStatus(null);
    const latestMeal = meals.find((m) => m.id === meal.id) ?? meal;
    setLastCartMealDetail(latestMeal);
    setCartItems((prev) => {
      const totalStock = Math.max(0, latestMeal.stock ?? 0);
      const nextKey = buildCartItemKey(latestMeal.id);
      const existing = prev.find((item) => item.key === nextKey);
      const existingQty = existing?.quantity ?? 0;
      if (totalStock <= existingQty) {
        Alert.alert(t('helper.home.stockLimitTitle'), t('helper.home.stockLimitMessage'));
        return prev;
      }
      if (!existing) {
        showCartToast();
        return [...prev, { key: nextKey, meal: latestMeal, quantity: 1, selectedAddons }];
      }
      showCartToast();
      return prev.map((item) =>
        item.key === nextKey
          ? {
              ...item,
              meal: latestMeal,
              quantity: item.quantity + 1,
              selectedAddons: mergeCartAddons(item.selectedAddons, selectedAddons),
            }
          : item,
      );
    });
  }

  function addMealToCart(meal: MealCard, selectedAddons: CartItem["selectedAddons"] = { free: [], paid: [] }) {
    const allergens = Array.isArray(meal.allergens) ? meal.allergens.filter(Boolean) : [];
    if (allergens.length > 0) {
      Alert.alert(
        t('helper.home.allergenTitle'),
        formatCopy('helper.home.allergenConfirm', { allergens: allergens.join('\n🔴 ') }),
        [
          { text: 'İptal', style: 'cancel' },
          { text: t('cta.home.addAnyway'), style: 'destructive', onPress: () => doAddMealToCart(meal, selectedAddons) },
        ],
      );
      return;
    }
    doAddMealToCart(meal, selectedAddons);
  }

  function toggleSelectedFreeAddon(addon: MealCard["addons"][number]) {
    if (addon.pricing !== "free") return;
    setSelectedMealAddons((prev) => {
      const exists = prev.free.some((item) => item.name === addon.name && item.kind === addon.kind);
      return exists
        ? { ...prev, free: prev.free.filter((item) => !(item.name === addon.name && item.kind === addon.kind)) }
        : { ...prev, free: [...prev.free, { name: addon.name, kind: addon.kind }] };
    });
  }

  function adjustSelectedPaidAddonQuantity(addon: MealCard["addons"][number], delta: -1 | 1) {
    if (addon.pricing !== "paid") return;
    const addonPrice = Number(addon.price ?? 0);
    if (!(addonPrice > 0)) return;

    setSelectedMealAddons((prev) => {
      const index = prev.paid.findIndex(
        (item) => item.name === addon.name && item.kind === addon.kind && item.price === addonPrice,
      );
      const nextPaid = [...prev.paid];
      if (index === -1) {
        if (delta < 0) return prev;
        nextPaid.push({ name: addon.name, kind: addon.kind, price: addonPrice, quantity: 1 });
        return { ...prev, paid: nextPaid };
      }
      const nextQuantity = Math.max(0, Math.min(10, nextPaid[index].quantity + delta));
      if (nextQuantity <= 0) {
        nextPaid.splice(index, 1);
        return { ...prev, paid: nextPaid };
      }
      nextPaid[index] = { ...nextPaid[index], quantity: nextQuantity };
      return { ...prev, paid: nextPaid };
    });
  }

  function decreaseCartItem(itemKey: string) {
    setActiveOrderId(null);
    setActiveOrderIds([]);
    setPaymentError(null);
    setPaymentInfo(null);
    setPaymentStatus(null);
    setCartItems((prev) => {
      const current = prev.find((item) => item.key === itemKey);
      if (!current) return prev;
      if (current.quantity <= 1) {
        return prev.filter((item) => item.key !== itemKey);
      }
      return prev.map((item) =>
        item.key === itemKey
          ? { ...item, quantity: item.quantity - 1 }
          : item,
      );
    });
  }

  function increaseCartItem(itemKey: string) {
    setActiveOrderId(null);
    setActiveOrderIds([]);
    setPaymentError(null);
    setPaymentInfo(null);
    setPaymentStatus(null);
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.key !== itemKey) return item;
        const totalStock = Math.max(0, item.meal.stock ?? 0);
        if (totalStock <= item.quantity) {
          Alert.alert(t('helper.home.stockLimitTitle'), t('helper.home.stockLimitMessage'));
          return item;
        }
        return { ...item, quantity: item.quantity + 1 };
      }),
    );
  }

  function adjustCartPaidAddonQuantity(
    itemKey: string,
    addonToAdjust: CartItem["selectedAddons"]["paid"][number],
    delta: -1 | 1,
  ) {
    setActiveOrderId(null);
    setActiveOrderIds([]);
    setPaymentError(null);
    setPaymentInfo(null);
    setPaymentStatus(null);
    setCartItems((prev) =>
      prev.map((item) =>
        item.key === itemKey
          ? { ...item, selectedAddons: adjustSpecificPaidAddonQuantity(item.selectedAddons, addonToAdjust, delta) }
          : item,
      ),
    );
  }

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  async function startCartCheckout() {
    if (cartItems.length === 0) {
      Alert.alert(t('helper.home.cartEmptyAlertTitle'), t('helper.home.cartEmptyAlertMessage'));
      return;
    }

    setPaymentLoading(true);
    setPaymentError(null);
    setPaymentInfo(null);
    try {
      const { createdOrderIds, firstCreatedStatus } = await createPickupOrdersFromCart();
      setActiveOrderId(createdOrderIds[0] ?? null);
      setActiveOrderIds(createdOrderIds);
      setPaymentStatus(
        createdOrderIds[0]
          ? {
              orderId: createdOrderIds[0],
              orderStatus: firstCreatedStatus,
              paymentCompleted: false,
            }
          : null,
      );
      setPaymentInfo(
        createdOrderIds.length > 1
          ? t('helper.home.paymentCapturePendingMultiple')
          : t('helper.home.paymentCapturePendingSingle'),
      );
      await fetchRecentBuyerOrders();
      void refreshPaymentStatus(false, createdOrderIds, true, true);
      setPaymentError(null);
      setCartItems([]);
    } catch (err) {
      setPaymentError(normalizeHomeRequestError(err, 'error.home.checkoutStartFailed'));
    } finally {
      setPaymentLoading(false);
    }
  }

  async function startDeliveryRequestFromCart() {
    if (deliveryRequestStarting) return;
    if (!onOpenOrderDetail) {
      Alert.alert(t('headline.common.error'), t('error.home.deliveryRequestFailed'));
      return;
    }
    setDeliveryRequestStarting(true);
    setPaymentError(null);
    setPaymentInfo(null);
    try {
      const { createdOrderIds, firstCreatedStatus, effectiveApiUrl } = await createPickupOrdersFromCart({ requireSingleSeller: true });
      const targetOrderId = createdOrderIds[0] ?? null;
      if (!targetOrderId) {
        throw new Error(t('error.home.checkoutMissingOrderId'));
      }

      const response = await authedJsonFetch(`${effectiveApiUrl}/v1/orders/${targetOrderId}/buyer-delivery-request`, {
        method: 'POST',
        headers: {
          'x-actor-role': 'buyer',
        },
        body: JSON.stringify({ requestedDeliveryType: 'delivery' }),
      });
      const json = await readJsonSafe<{ error?: { message?: string } }>(response);
      if (!response.ok) {
        throw new Error(json?.error?.message ?? t('error.home.deliveryRequestFailed'));
      }

      setActiveOrderId(targetOrderId);
      setActiveOrderIds(createdOrderIds);
      setPaymentStatus({
        orderId: targetOrderId,
        orderStatus: firstCreatedStatus,
        paymentCompleted: false,
      });
      setPaymentInfo(t('helper.home.deliveryRequestSuccess'));
      setCartItems([]);
      await fetchRecentBuyerOrders();
      onOpenOrderDetail(targetOrderId);
    } catch (error) {
      Alert.alert(
        t('headline.common.error'),
        error instanceof Error ? error.message : t('error.home.deliveryRequestFailed'),
      );
    } finally {
      setDeliveryRequestStarting(false);
    }
  }

  async function refreshPaymentStatus(waitForSettlement = false, overrideOrderIds?: string[], orderCreatedByUs = false, silent = false) {
    const orderIds = (overrideOrderIds && overrideOrderIds.length > 0
      ? overrideOrderIds
      : activeOrderIds.length > 0
      ? activeOrderIds
      : activeOrderId
        ? [activeOrderId]
        : paymentStatus?.orderId
          ? [paymentStatus.orderId]
          : []);
    if (orderIds.length === 0) return;
    if (!silent) {
      setPaymentLoading(true);
    }
    if (!orderCreatedByUs && !silent) setPaymentError(null);
    try {
      const loadSnapshots = async () => Promise.all(
        orderIds.map(async (oid) => {
          const response = await authedJsonFetch(`${apiUrl}/v1/payments/${oid}/status`, {
            headers: { 'x-actor-role': 'buyer' },
          });
          const json = await readJsonSafe<{
            data?: {
              orderId?: string;
              orderStatus?: string;
              paymentCompleted?: boolean;
              latestAttempt?: { status?: string };
            };
            error?: { message?: string };
          }>(response);
          if (!response.ok) {
            throw new Error(t('error.home.paymentStatusFailed'));
          }
          return {
            orderId: String(json?.data?.orderId ?? oid),
            orderStatus: String(json?.data?.orderStatus ?? 'pending_seller_approval'),
            paymentCompleted: Boolean(json?.data?.paymentCompleted),
            latestAttemptStatus: json?.data?.latestAttempt?.status
              ? String(json.data.latestAttempt.status)
              : undefined,
          } as PaymentStatusSnapshot;
        }),
      );

      const snapshots = await loadSnapshots();
      if (waitForSettlement) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const completedCount = snapshots.filter((s) => s.paymentCompleted).length;
      setPaymentStatus(snapshots[0] ?? null);
      if (snapshots.length > 1) {
        if (completedCount > 0) {
          setPaymentInfo(formatCopy('helper.home.paymentProgress', { completed: completedCount, total: snapshots.length }));
        } else {
          setPaymentInfo(t('helper.home.paymentCapturePendingMultiple'));
        }
      } else if (completedCount === 1) {
        setPaymentInfo(t('helper.home.paymentCaptureDoneSingle'));
      } else {
        setPaymentInfo(t('helper.home.paymentCapturePendingSingle'));
      }
      if (completedCount === snapshots.length && snapshots.length > 0) {
        setCartItems([]);
      }
    } catch (err) {
      // If the order was successfully created, don't overwrite the success state with a status-poll error.
      if (!orderCreatedByUs && !silent) {
        setPaymentError(normalizeHomeRequestError(err, 'error.home.paymentStatusFailed'));
      }
    } finally {
      if (!silent) {
        setPaymentLoading(false);
      }
      void fetchRecentBuyerOrders();
    }
  }

  function renderMessagesWallpaper(
    wallpaper: (typeof MESSAGE_WALLPAPERS)[number],
  ) {
    switch (wallpaper.kind) {
      case 'stripes':
        return (
          <>
            <View style={[styles.messagesStripeA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesStripeB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesStripeC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'grid':
        return (
          <>
            <View style={[styles.messagesGridVertical, { borderColor: wallpaper.c1 }]} />
            <View style={[styles.messagesGridHorizontal, { borderColor: wallpaper.c2 }]} />
            <View style={[styles.messagesGridSpot, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'rings':
        return (
          <>
            <View style={[styles.messagesRingA, { borderColor: wallpaper.c1 }]} />
            <View style={[styles.messagesRingB, { borderColor: wallpaper.c2 }]} />
            <View style={[styles.messagesRingC, { borderColor: wallpaper.c3 }]} />
          </>
        );
      case 'diagonal':
        return (
          <>
            <View style={[styles.messagesDiagA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesDiagB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesDiagC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'cards':
        return (
          <>
            <View style={[styles.messagesCardA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesCardB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesCardC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'waves':
        return (
          <>
            <View style={[styles.messagesWaveA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesWaveB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesWaveC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'dots':
        return (
          <>
            <View style={[styles.messagesDotsA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesDotsB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesDotsC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'sunset':
        return (
          <>
            <View style={[styles.messagesSunsetSky, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesSunsetHorizon, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesSunsetSun, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'minimal':
        return (
          <>
            <View style={[styles.messagesMinLineA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesMinLineB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesMinDot, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'blobs':
      default:
        return (
          <>
            <View style={[styles.messagesBlob1, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesBlob2, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesBlob3, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
    }
  }

  function handleTabPress(tab: TabKey) {
    if (tab === 'messages' && onOpenChatList) { onOpenChatList(); return; }
    if (tab === 'notifications' && onOpenNotifications) { onOpenNotifications(); return; }
    setActiveTab(tab);
  }

  function openMealDetail(meal: MealCard) {
    setLastCartMealDetail(meal);
    setSelectedMeal(meal);
  }

  function openMealDetailFromSeller(meal: MealCard) {
    closeSellerModalWithCallback(() => {
      if (selectedMeal?.id === meal.id) {
        // Force reopen when the same meal is tapped from seller modal.
        setMealModalAnimType('none');
        setSelectedMeal(null);
        requestAnimationFrame(() => {
          openMealDetail(meal);
        });
        return;
      }
      openMealDetail(meal);
    });
  }

  function handleCartBackPress() {
    const hasPendingListState =
      cartItems.length === 0 && (paymentLoading || !!paymentStatus || !!paymentInfo || !!paymentError);
    if (hasPendingListState) {
      setActiveTab('home');
      return;
    }
    const fallbackFromCart = cartItems.length > 0 ? cartItems[cartItems.length - 1].meal : null;
    const mealToOpen = lastCartMealDetail ?? fallbackFromCart;
    if (!mealToOpen) {
      setActiveTab('home');
      return;
    }
    setActiveTab('home');
    openMealDetail(mealToOpen);
  }

  function handleSloganMarqueePress() {
    feedScrollRef.current?.scrollTo({
      y: Math.max(0, foodSectionOffsetY - 12),
      animated: true,
    });
  }

  async function handleLanguageChange(language: AppSettings['language']) {
    const settings = await loadSettings();
    await saveSettings({ ...settings, language });
    setAppLanguage(language);
  }

  /* ---------- Filtered meals ---------- */

  const filteredMeals =
    activeCategory === 'Tümü'
      ? meals
      : meals.filter((m) => m.category === activeCategory);
  const nearbyFilteredMeals = nearbyOnly
    ? filteredMeals.filter((m) => {
        const km = parseDistanceKm(m.distance);
        return km !== null && km <= 2;
      })
    : filteredMeals;
  const baseVisibleMeals =
    nearbyOnly && nearbyFilteredMeals.length === 0
      ? filteredMeals
      : nearbyFilteredMeals;
  const visibleMeals = searchQuery.trim()
    ? meals.filter((m) => {
        const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
        return (
          m.title.toLocaleLowerCase('tr-TR').includes(q) ||
          m.seller.toLocaleLowerCase('tr-TR').includes(q)
        );
      })
    : baseVisibleMeals;
  const sellerMeals = selectedSeller
    ? meals.filter((meal) => meal.sellerId === selectedSeller.id)
    : [];
  const sellerAverageRating = sellerMeals.length
    ? (
        sellerMeals.reduce(
          (sum, meal) => sum + (Number.parseFloat(meal.rating) || 0),
          0,
        ) / sellerMeals.length
      ).toFixed(1)
    : '0.0';
  const sellerProfile = selectedSeller
    ? buildSellerProfile(selectedSeller.id, selectedSeller.name, sellerMeals)
    : null;

  useEffect(() => {
    if (!selectedSeller) {
      setSellerReviews([]);
      setSellerReviewsLoading(false);
      setSellerReviewsError(null);
      setSellerCompletedMealsSold(null);
      setSellerCompletedMealsLoading(false);
      return;
    }
    let cancelled = false;
    setSellerReviewsLoading(true);
    setSellerReviewsError(null);
    fetch(`${apiUrl}/v1/foods/sellers/${selectedSeller.id}/reviews`, {
      headers: { Authorization: `Bearer ${currentAuthRef.current.accessToken}` },
    })
      .then(async (response) => {
        const json = await readJsonSafe<{ data?: SellerReview[]; error?: { message?: string } }>(response);
        if (!response.ok) {
          throw new Error(json.error?.message ?? requestErrorLine(response.status));
        }
        return json.data ?? [];
      })
      .then((reviews) => {
        if (cancelled) return;
        setSellerReviews(reviews);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSellerReviews([]);
        setSellerReviewsError(err instanceof Error ? err.message : 'Yorumlar yüklenemedi');
      })
      .finally(() => {
        if (cancelled) return;
        setSellerReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeller?.id, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedSeller) {
      setSellerCompletedMealsSold(null);
      setSellerCompletedMealsLoading(false);
      return;
    }
    let cancelled = false;
    setSellerCompletedMealsLoading(true);
    fetch(`${apiUrl}/v1/foods/sellers/${selectedSeller.id}/completed-sales`, {
      headers: { Authorization: `Bearer ${currentAuthRef.current.accessToken}` },
    })
      .then(async (response) => {
        const json = await readJsonSafe<SellerCompletedSalesResponse>(response);
        if (!response.ok) {
          throw new Error(json.error?.message ?? requestErrorLine(response.status));
        }
        return Number(json.data?.totalCompletedMeals ?? 0);
      })
      .then((count) => {
        if (cancelled) return;
        setSellerCompletedMealsSold(count);
      })
      .catch(() => {
        if (cancelled) return;
        setSellerCompletedMealsSold(0);
      })
      .finally(() => {
        if (cancelled) return;
        setSellerCompletedMealsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeller?.id, apiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedSeller) return;
    sellerModalSlideX.setValue(Dimensions.get('window').width);
    Animated.timing(sellerModalSlideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selectedSeller, sellerModalSlideX]);

  function closeSellerModalWithCallback(onClosed?: () => void) {
    if (!selectedSeller) {
      setSellerModalTouchGuardUntil(0);
      onClosed?.();
      return;
    }
    Animated.timing(sellerModalSlideX, {
      toValue: Dimensions.get('window').width,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setSelectedSeller(null);
      setSellerModalTouchGuardUntil(0);
      onClosed?.();
    });
  }

  function closeSellerModal() {
    closeSellerModalWithCallback();
  }


  /* ---------- Render helpers ---------- */

  function renderPromoFallbackCard(context: 'home' | 'cart') {
    const content = (
      <>
        <View style={styles.nearbyHeaderLeft}>
          <View style={styles.nearbyHeaderIconBox}>
            <Ionicons name="heart" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.nearbyHeaderTextWrap}>
            <Text style={styles.nearbyHeaderTitle}>{t('headline.home.slogan')}</Text>
            <Text style={styles.nearbyHeaderSubtitle}>{t('helper.home.sloganSubline')}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#8B6A52" />
      </>
    );

    if (context === 'home') {
      return (
        <TouchableOpacity style={styles.nearbyHeader} activeOpacity={0.88} onPress={onOpenOrders}>
          {content}
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.tabPanelCard}>
        <TouchableOpacity style={styles.nearbyHeaderCompact} activeOpacity={0.88} onPress={onOpenOrders}>
          {content}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryOrdersBtn} activeOpacity={0.88} onPress={onOpenOrders}>
          <Text style={styles.secondaryOrdersBtnText}>{t('cta.orders.viewAll')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderQuickOrderCard(context: 'home' | 'cart') {
    if (actionableHomeOrders.length === 0) return null;
    const wrapperStyle = context === 'home' ? styles.quickOrderPromoCard : styles.quickOrderCartCard;
    const cardStyle = context === 'home' ? styles.quickOrderScrollCardHome : styles.quickOrderScrollCardCart;

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickOrderScrollerContent}
        style={styles.quickOrderScroller}
      >
        {actionableHomeOrders.map((order, index) => {
          const showRefresh = shouldShowQuickOrderRefresh(order.id);

          const isPendingProposal = order.status === 'pending_buyer_confirmation';
          const liveStatus = quickOrderLiveStatus(order.status);
          const canShowDeliveryPin = String(order.status ?? '').trim().toLowerCase() === 'at_door';
          const openOrderFlowDetail = Boolean(onOpenOrderDetail);
          const handleCardPress = openOrderFlowDetail
            ? () => onOpenOrderDetail?.(order.id)
            : onOpenOrders;

          return (
            <TouchableOpacity
              key={order.id}
              style={[wrapperStyle, cardStyle, index === actionableHomeOrders.length - 1 && styles.quickOrderScrollCardLast]}
              activeOpacity={0.9}
              onPress={handleCardPress}
            >
              <View style={styles.quickOrderTopRow}>
                <View style={styles.quickOrderTitleBlock}>
                  <Text style={styles.quickOrderEyebrow}>
                    {index === 0 ? t('headline.orders.quickActiveTitle') : t('status.orders.newBadge')}
                  </Text>
                  <Text style={styles.quickOrderSeller} numberOfLines={1}>{order.sellerName}</Text>
                  <View style={styles.quickOrderMetaRow}>
                    <Text style={[styles.quickOrderMeta, styles.quickOrderMetaNo]} numberOfLines={1} ellipsizeMode="tail">
                      {formatHomeOrderNo(order.id, order.orderNo)} ·
                    </Text>
                    <Text style={[styles.quickOrderMeta, styles.quickOrderMetaDate]} numberOfLines={1} ellipsizeMode="clip">
                      {formatHomeOrderDate(order.createdAt)}
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.quickOrderLiveChip,
                    liveStatus.tone === 'warn' && styles.quickOrderLiveChipWarn,
                    liveStatus.tone === 'accent' && styles.quickOrderLiveChipAccent,
                  ]}
                >
                  <Text
                    style={[
                      styles.quickOrderLiveChipText,
                      liveStatus.tone === 'warn' && styles.quickOrderLiveChipTextWarn,
                      liveStatus.tone === 'accent' && styles.quickOrderLiveChipTextAccent,
                    ]}
                  >
                    {liveStatus.label}
                  </Text>
                </View>
              </View>

              <View style={styles.quickOrderMessageCard}>
                <View style={styles.quickOrderMessageHeader}>
                  <Ionicons name="chatbubble-ellipses-outline" size={13} color="#2F6F4A" />
                  <Text style={styles.quickOrderMessageLabel}>Ustadan mesaj</Text>
                </View>
                <Text style={styles.quickOrderMessageText} numberOfLines={3}>
                  {order.lastSellerNote
                    ? order.lastSellerNote
                    : isPendingProposal
                      ? t('helper.orders.proposalPendingSubtitle')
                      : hasPendingBuyerDeliveryRequest(order)
                        ? t('helper.home.deliveryRequestPending')
                        : latestHomeOrderHint(order.status)}
                </Text>
              </View>
              <View style={styles.quickOrderItemsRow}>
                <Text style={styles.quickOrderItems} numberOfLines={1}>
                  {summarizeHomeOrderItems(order.items)}
                </Text>
                {order.totalPrice > 0 ? (
                  <View style={styles.quickOrderItemsPriceWrap}>
                    <Text style={styles.quickOrderItemsDelivery} numberOfLines={1} ellipsizeMode="tail">
                      {order.deliveryType === 'delivery'
                        ? t('status.orders.deliveryType.delivery')
                        : t('status.orders.deliveryType.pickup')}
                    </Text>
                    <Text style={styles.quickOrderItemsPrice} numberOfLines={1} ellipsizeMode="clip">
                      {formatPrice(order.totalPrice)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.quickOrderFooter}>
                <View style={styles.quickOrderActions}>
                  <View style={styles.quickOrderMainActionsRow}>
                    {canShowDeliveryPin ? (
                      <TouchableOpacity
                        style={[styles.quickOrderMainActionBtn, styles.quickOrderSecondaryBtn]}
                        activeOpacity={0.88}
                        onPress={(event) => {
                          event.stopPropagation();
                          setDeliveryPinModalVisible(true);
                          void fetchDeliveryProof(order.id);
                        }}
                      >
                        <Text style={styles.quickOrderSecondaryText} numberOfLines={1} ellipsizeMode="tail">
                          Teslimat Kodu
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {canRequestBuyerDelivery(order) ? (
                      <TouchableOpacity
                        style={[
                          styles.quickOrderMainActionBtn,
                          styles.quickOrderSecondaryBtn,
                          deliveryRequestOrderIds[order.id] && styles.paymentRefreshBtnDisabled,
                        ]}
                        activeOpacity={0.88}
                        onPress={(event) => {
                          event.stopPropagation();
                          void requestDeliveryForOrder(order);
                        }}
                        disabled={Boolean(deliveryRequestOrderIds[order.id])}
                      >
                        {deliveryRequestOrderIds[order.id] ? (
                          <ActivityIndicator size="small" color="#2F6F4A" />
                        ) : (
                          <Text style={styles.quickOrderSecondaryText} numberOfLines={1} ellipsizeMode="tail">
                            {t('cta.home.requestDelivery')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.quickOrderMainActionBtn, styles.quickOrderPrimaryBtn]}
                      activeOpacity={0.88}
                      onPress={(event) => {
                        event.stopPropagation();
                        if (onOpenOrderDetail) {
                          onOpenOrderDetail(order.id);
                        } else {
                          onOpenOrders();
                        }
                      }}
                    >
                      <Text style={styles.quickOrderPrimaryText} numberOfLines={1} ellipsizeMode="tail">
                        {isPendingProposal ? t('cta.home.viewProposal') : t('cta.orders.viewAll')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }

  function renderHomeFeed() {
    const handleFeedScroll = (event: any) => {
      const y = Number(event?.nativeEvent?.contentOffset?.y ?? 0);
      const contentH = Number(event?.nativeEvent?.contentSize?.height ?? 0);
      const viewportH = Number(event?.nativeEvent?.layoutMeasurement?.height ?? 0);
      const maxY = Math.max(0, contentH - viewportH);
      const EXIT_THRESHOLD = 24;
      const HERO_ZONE_Y = 250;
      const HERO_TONE = '#FDDEB7';
      const SURFACE_TONE = '#FFFBF4';
      const HERO_FADE_START_Y = 40;
      const HERO_FADE_END_Y = HERO_ZONE_Y - 14;

      let nextBg = SURFACE_TONE;
      let zone = overscrollZoneRef.current;

      if (zone === 'top') {
        if (y > HERO_ZONE_Y + EXIT_THRESHOLD) zone = 'none';
      } else if (zone === 'bottom') {
        if (y < maxY - EXIT_THRESHOLD) zone = 'none';
      } else {
        if (y < 0 || y <= HERO_ZONE_Y) zone = 'top';
        else if (y > maxY) zone = 'bottom';
      }

      overscrollZoneRef.current = zone;

      let blendedTopTone = HERO_TONE;
      if (y >= HERO_FADE_END_Y) {
        blendedTopTone = SURFACE_TONE;
      } else if (y > HERO_FADE_START_Y) {
        const raw = (y - HERO_FADE_START_Y) / (HERO_FADE_END_Y - HERO_FADE_START_Y);
        blendedTopTone = blendHexColors(HERO_TONE, SURFACE_TONE, smoothstep01(raw));
      }

      if (zone === 'top') {
        if (y <= 0) {
          nextBg = HERO_TONE;
        } else {
          nextBg = blendedTopTone;
        }
      } else if (zone === 'bottom') {
        nextBg = SURFACE_TONE; // bottom overscroll: kart zemini tonu
      }

      if (nextBg !== scrollSurfaceBgRef.current) {
        scrollSurfaceBgRef.current = nextBg;
        setScrollSurfaceBg(nextBg);
      }

    };

    return (
      <ScrollView
        ref={feedScrollRef}
        showsVerticalScrollIndicator={false}
        onScroll={handleFeedScroll}
        scrollEventThrottle={8}
        contentContainerStyle={styles.scrollContent}
        style={[styles.scroll, { backgroundColor: scrollSurfaceBg }]}
        stickyHeaderIndices={[1]}
      >
        {/* Hero Header */}
        <View style={styles.heroWrap}>
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(255, 235, 205, 0.98)', 'rgba(255, 235, 205, 0.82)', 'rgba(255, 235, 205, 0.28)', 'rgba(255, 235, 205, 0)']}
              locations={[0, 0.28, 0.68, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.heroBaseGradient}
            />
          ) : null}
          <Image
            source={headerImageSource}
            style={styles.heroFoodBgImg}
            onError={() => setHeaderImageSource(LOCAL_HOME_HEADER_FALLBACK)}
          />
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(191, 132, 91, 0.22)', 'rgba(191, 132, 91, 0.1)', 'rgba(191, 132, 91, 0)']}
              locations={[0, 0.16, 0.34]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroFoodBgEdgeFade}
            />
          ) : null}
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(255, 228, 196, 1)', 'rgba(255, 228, 196, 0.9)', 'rgba(255, 228, 196, 0.42)', 'rgba(255, 228, 196, 0)']}
              locations={[0, 0.32, 0.72, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.heroFeatherLeft}
            />
          ) : null}
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(253, 222, 183, 0.98)', 'rgba(253, 222, 183, 0.68)', 'rgba(253, 222, 183, 0)']}
              locations={[0, 0.52, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.heroFeatherTop}
            />
          ) : null}
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(255, 251, 244, 1)', 'rgba(255, 255, 255, 0)']}
              locations={[0, 1]}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              style={styles.heroFeatherBottom}
            />
          ) : null}
          {LinearGradient ? (
            <LinearGradient
              colors={['rgba(253, 222, 183, 0)', 'rgba(253, 222, 183, 0.28)', 'rgba(253, 222, 183, 0.58)']}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.heroFeatherRight}
            />
          ) : null}
          <View pointerEvents="none" style={styles.heroRightSeamCover} />
          <View style={styles.heroTextArea}>
            <View style={styles.heroIdentityRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.heroAvatarCircle}
                onPress={() => handleTabPress('profile')}
              >
                {profileImageUrl && !profileImageLoadFailed ? (
                  <Image
                    source={{ uri: profileImageUrl }}
                    style={styles.heroAvatarImage}
                    onError={() => setProfileImageLoadFailed(true)}
                  />
                ) : cachedLocalImageUrl ? (
                  <Image source={{ uri: cachedLocalImageUrl }} style={styles.heroAvatarImage} />
                ) : (
                  <Text style={styles.avatarEmoji}>👩‍🍳</Text>
                )}
              </TouchableOpacity>
              <View style={styles.heroGreetingArea}>
                <View style={styles.greetingTitleWrap}>
                  <Text
                    style={[styles.greetingTitle, resolveGreetingTitleMetrics(dynamicGreetingTitle.text)]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {dynamicGreetingTitle.text}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.heroSubtitle}>{greetingSubtitle}</Text>
            <TouchableOpacity
              onPress={() => setLocationModalVisible(true)}
              activeOpacity={0.8}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={styles.heroLocationRow}
            >
              <Ionicons name="location-outline" size={15} color="#B15735" />
              <Text style={styles.heroLocationText}>{selectedLocationLabel}</Text>
              <Ionicons name="chevron-down" size={14} color="#B15735" style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>
        </View>
        {/* Sticky: Search Bar + Category Chips */}
        <View style={styles.stickySearchChips}>
          <View style={styles.floatingSearchWrap}>
            <TouchableOpacity
              style={[styles.floatingSearchBar, searchMode && styles.floatingSearchBarActive]}
              activeOpacity={0.95}
              onPress={() => !searchMode && setSearchMode(true)}
            >
              <Ionicons name="search-outline" size={22} color="#6B4D3A" style={{ marginRight: 10 }} />
              {searchMode ? (
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('helper.home.searchPlaceholder')}
                  placeholderTextColor="#BDBDBD"
                  style={styles.floatingSearchInput}
                  returnKeyType="search"
                  autoFocus
                />
              ) : (
                <Text style={styles.floatingSearchPlaceholder}>{t('helper.home.searchPlaceholder')}</Text>
              )}
              {searchMode ? (
                <TouchableOpacity
                  style={styles.floatingSearchFilterBtn}
                  activeOpacity={0.7}
                  onPress={() => { setSearchMode(false); setSearchQuery(''); }}
                >
                  <Ionicons name="close-outline" size={24} color="#6B4D3A" />
                </TouchableOpacity>
              ) : (
                <View style={styles.floatingSearchFilterBtn}>
                  <Ionicons name="options-outline" size={22} color="#6B4D3A" />
                </View>
              )}
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            style={styles.chipScroller}
          >
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, activeCategory === cat && styles.chipActive]}
                activeOpacity={0.85}
                onPress={() => setActiveCategory(cat)}
              >
                <Ionicons
                  name={cat === 'Tümü' ? 'grid' : (CATEGORY_ICONS[cat] || 'restaurant-outline')}
                  size={18}
                  color={activeCategory === cat ? '#fff' : '#5A3E2B'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>
                  {CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        {showHomeOrderPromo ? renderQuickOrderCard('home') : renderPromoFallbackCard('home')}
        <View onLayout={(e) => setFoodSectionOffsetY(e.nativeEvent.layout.y)} />
        <View style={styles.recommendationsSection}>
          <Text style={styles.recommendationsSectionTitle}>{t('status.home.recommendations')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.recommendationsScroller}
            contentContainerStyle={styles.recommendationsRow}
          >
            {recommendedMealsLoading ? (
              <View style={styles.topSoldLoadingChip}>
                <ActivityIndicator size="small" color="#4A7C59" />
                <Text style={styles.topSoldLoadingText}>{t('status.home.recommendationsLoading')}</Text>
              </View>
            ) : null}
            {!recommendedMealsLoading && visibleRecommendedMeals.length === 0 ? (
              <View style={styles.topSoldLoadingChip}>
                <Text style={styles.topSoldLoadingText}>{t('status.home.recommendationsEmpty')}</Text>
              </View>
            ) : null}
            {visibleRecommendedMeals.map((meal) => (
              <RecommendationCard
                key={`rec-${meal.id}`}
                meal={meal}
                onPress={() => openMealDetail(meal)}
              />
            ))}
          </ScrollView>
        </View>
        {mealsLoading ? (
          <View style={styles.topSoldLoadingChip}>
            <ActivityIndicator size="small" color="#4A7C59" />
            <Text style={styles.topSoldLoadingText}>{t('status.home.mealsLoading')}</Text>
          </View>
        ) : mealsError ? (
          <View style={styles.topSoldLoadingChip}>
            <Text style={styles.topSoldLoadingText}>{mealsError}</Text>
          </View>
        ) : visibleMeals.length === 0 ? (
          <View style={styles.topSoldLoadingChip}>
            <Text style={styles.topSoldLoadingText}>{t('helper.home.noActiveMeals')}</Text>
          </View>
        ) : (
          visibleMeals.map((meal) => {
            return (
              <FoodCard
                key={meal.id}
                meal={meal}
                isFavorite={Boolean(favoriteIds[meal.id])}
                favoritePending={Boolean(favoritePendingIds[meal.id])}
                onPress={() => openMealDetail(meal)}
                onFavoritePress={() => {
                  void toggleFavorite(meal.id);
                }}
              />
            );
          })
        )}

      </ScrollView>
    );
  }

  function renderContent() {
    if (activeTab === 'messages') {
      const wallpaper = MESSAGE_WALLPAPERS[messagesWallpaperIndex];
      return (
        <KeyboardAvoidingView
          style={styles.messagesTabWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 78 : 0}
        >
          <View
            pointerEvents="none"
            style={[styles.messagesWallpaper, { backgroundColor: wallpaper.bg }]}
          >
            {renderMessagesWallpaper(wallpaper)}
          </View>
          <View style={styles.messagesTabHeader}>
            <View style={styles.messagesTabHeaderText}>
              <Text style={styles.messagesTabTitle}>{t('status.home.messagesTitle')}</Text>
              <Text style={styles.messagesTabSubtitle}>{t('helper.home.messagesSubtitle')}</Text>
            </View>
            <TouchableOpacity
              style={styles.messagesWallpaperBtn}
              onPress={handleWallpaperSwitch}
              activeOpacity={0.85}
            >
              <Ionicons name="color-palette-outline" size={19} color="#5F5246" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={inboxMessages}
            renderItem={renderChatMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chatList}
            style={styles.chatListContainer}
          />
          <View style={styles.chatInputRow}>
            <TextInput
              value={inboxInput}
              onChangeText={setInboxInput}
              placeholder={t('helper.home.messageInputPlaceholder')}
              placeholderTextColor="#A89B8C"
              style={styles.chatTextInput}
              returnKeyType="send"
              onSubmitEditing={handleInboxSend}
            />
            <TouchableOpacity
              style={styles.chatSendBtn}
              onPress={handleInboxSend}
            >
              <Ionicons name="arrow-up" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      );
    }
    if (activeTab === 'cart') {
      const subtotal = cartItems.reduce((sum, item) => {
        const value = Number(item.meal.price.replace(/[^\d.,]/g, '').replace(',', '.'));
        const addonsTotal = item.selectedAddons.paid.reduce(
          (addonSum, addon) => addonSum + (addon.price * addon.quantity),
          0,
        );
        return sum + (value * item.quantity) + addonsTotal;
      }, 0);
      const total = subtotal;
      const showCartPromoFallback = cartItems.length === 0 && !showCartQuickOrderCard;
      const showCartPendingApprovalState =
        cartItems.length === 0
        && hideCartQuickOrderCard
        && Boolean(paymentInfo || paymentStatus);
      return (
        <View style={styles.cartWrap}>
          <View style={styles.cartHeader}>
            <View style={styles.cartHeaderLeft}>
              <TouchableOpacity
                style={styles.cartBackBtn}
                onPress={handleCartBackPress}
                activeOpacity={0.8}
              >
                <Ionicons name="chevron-back" size={22} color="#4E433A" />
              </TouchableOpacity>
              <Text style={styles.tabPanelTitle}>
                {showCartQuickOrderCard
                  ? t('headline.orders.quickActiveTitle')
                  : t('headline.home.foodListTitle')}
              </Text>
            </View>
            <Text style={styles.cartHeaderCount}>
              {cartItems.length === 0 ? '' : `${cartCount} ${t('status.home.foodListCountSuffix')}`}
            </Text>
          </View>
          {cartItems.length === 0 ? (
            showCartPendingApprovalState ? (
              <View style={styles.tabPanelCard}>
                <Text style={styles.tabPanelTitle}>{t('status.home.pendingApprovalTitle')}</Text>
                <Text style={styles.tabPanelText}>
                  {paymentInfo ?? t('helper.home.paymentCapturePendingSingle')}
                </Text>
              </View>
            ) : showCartQuickOrderCard ? (
              <View>
                <View style={styles.tabPanelCardCompact}>
                  {renderQuickOrderCard('cart')}
                </View>
                {paymentInfo ? <Text style={styles.paymentInfoTextCompact}>{paymentInfo}</Text> : null}
              </View>
            ) : showCartPromoFallback ? (
              renderPromoFallbackCard('cart')
            ) : (
              <View style={styles.tabPanelCard}>
                <Text style={styles.tabPanelText}>{t('helper.home.cartEmptyTitle')}</Text>
              </View>
            )
          ) : (
            <>
              <ScrollView
                style={styles.cartList}
                contentContainerStyle={[
                  styles.cartListContent,
                  { paddingBottom: cartBottomBarHeight + 16 },
                ]}
                showsVerticalScrollIndicator={false}
              >
                <View>
                  {cartItems.map((item) => {
                    const unitPrice = Number(item.meal.price.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                    const addonsUnitTotal = item.selectedAddons.paid.reduce(
                      (sum, addon) => sum + (Number(addon.price ?? 0) * Number(addon.quantity ?? 1)),
                      0,
                    );
                    const itemTotal = (unitPrice * item.quantity) + addonsUnitTotal;
                    return (
                      <View key={item.key} style={styles.cartItemCard}>
                        <View style={styles.cartItemTextWrap}>
                          <Text style={styles.cartItemTitle}>{item.meal.title}</Text>
                          <Text style={styles.cartItemSeller}>
                            {formatSellerIdentity(item.meal.seller, item.meal.sellerUsername)}
                          </Text>
                          {item.selectedAddons.free.length > 0 ? (
                            <Text style={styles.cartAddonLine}>
                              Ücretsiz: {item.selectedAddons.free.map((addon) => addon.name).join(', ')}
                            </Text>
                          ) : null}
                          {item.selectedAddons.paid.length > 0 ? (
                            <>
                              {item.selectedAddons.paid.map((addon, addonIndex) => (
                                <View key={`${item.key}-paid-${addon.name}-${addonIndex}`} style={styles.cartAddonRow}>
                                  <Text style={styles.cartAddonLine}>
                                    • {addon.name} x{addon.quantity} (+₺{(addon.price * addon.quantity).toFixed(2)})
                                  </Text>
                                  <View style={styles.cartAddonQtyRow}>
                                    <TouchableOpacity
                                      style={styles.cartAddonQtyBtn}
                                      onPress={() => adjustCartPaidAddonQuantity(item.key, addon, -1)}
                                      activeOpacity={0.85}
                                    >
                                      <Ionicons name="remove" size={12} color="#8A4B16" />
                                    </TouchableOpacity>
                                    <Text style={styles.cartAddonQtyText}>{addon.quantity}</Text>
                                    <TouchableOpacity
                                      style={styles.cartAddonQtyBtn}
                                      onPress={() => adjustCartPaidAddonQuantity(item.key, addon, 1)}
                                      activeOpacity={0.85}
                                    >
                                      <Ionicons name="add" size={12} color="#8A4B16" />
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              ))}
                            </>
                          ) : null}
                        </View>
                        <View style={styles.cartItemRight}>
                          <Text style={styles.cartItemPrice}>
                            ₺{unitPrice.toFixed(2)} x {item.quantity}
                          </Text>
                          <Text style={styles.cartItemTotal}>Ara toplam: ₺{itemTotal.toFixed(2)}</Text>
                          <View style={styles.cartQtyRow}>
                            <TouchableOpacity
                              style={styles.cartQtyBtn}
                              onPress={() => decreaseCartItem(item.key)}
                              activeOpacity={0.85}
                            >
                              <Ionicons name="remove" size={14} color="#5F5246" />
                            </TouchableOpacity>
                            <Text style={styles.cartQtyText}>{item.quantity}</Text>
                            <TouchableOpacity
                              style={styles.cartQtyBtn}
                              onPress={() => increaseCartItem(item.key)}
                              activeOpacity={0.85}
                            >
                              <Ionicons name="add" size={14} color="#5F5246" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
              <View
                style={styles.cartBottomBar}
                onLayout={(event) => {
                  const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                  if (Math.abs(nextHeight - cartBottomBarHeight) > 4) {
                    setCartBottomBarHeight(nextHeight);
                  }
                }}
              >
                <View style={styles.cartFooter}>
                  <View style={styles.cartTotalRow}>
                    <Text style={styles.cartTotalLabel}>Toplam</Text>
                    <Text style={styles.cartTotalValue}>₺{total.toFixed(2)}</Text>
                  </View>
                </View>
                {paymentStatus ? (
                  <View style={styles.paymentStatusCard}>
                    <Text style={styles.paymentStatusTitle}>{t('status.home.paymentTitle')}</Text>
                    <Text style={styles.paymentStatusText}>{t('status.home.orderLabel')} {paymentStatus.orderId.slice(0, 8)}...</Text>
                    <Text style={styles.paymentStatusText}>{t('status.home.orderStatusLabel')} {formatOrderStatusLabel(paymentStatus.orderStatus)}</Text>
                    <Text style={styles.paymentStatusText}>
                      {paymentStatus.paymentCompleted ? t('status.home.paymentDone') : formatPaymentAttemptLabel(paymentStatus.latestAttemptStatus)}
                    </Text>
                  </View>
                ) : null}
                {paymentInfo ? (
                  <Text style={styles.paymentInfoText}>{paymentInfo}</Text>
                ) : null}
                <View style={styles.paymentActionsColumn}>
                  <TouchableOpacity
                    style={[styles.paymentActionBtn, paymentLoading && styles.paymentActionBtnDisabled]}
                    onPress={() => void startCartCheckout()}
                    activeOpacity={0.9}
                    disabled={paymentLoading}
                  >
                    {paymentLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.paymentActionBtnText}>{t('cta.home.cartCheckout')}</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.paymentActionHintBox}>
                    <Text style={styles.paymentActionHintStrong}>{t('helper.home.createDeliveryChatHint')}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.paymentSecondaryActionBtn,
                      deliveryRequestStarting && styles.paymentActionBtnDisabled,
                    ]}
                    onPress={() => void startDeliveryRequestFromCart()}
                    activeOpacity={0.9}
                    disabled={deliveryRequestStarting}
                  >
                    {deliveryRequestStarting ? (
                      <ActivityIndicator size="small" color="#2F6F4A" />
                    ) : (
                      <Text style={styles.paymentSecondaryActionBtnText}>{t('cta.home.createDeliveryChat')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      );
    }
    if (activeTab === 'notifications') {
      return (
        <View style={styles.tabPanelCard}>
          <Text style={styles.tabPanelTitle}>{t('status.home.notificationsTitle')}</Text>
          <Text style={styles.tabPanelText}>{t('helper.home.notificationsEmpty')}</Text>
        </View>
      );
    }
    if (activeTab === 'profile') {
      return (
        <ScrollView
          style={styles.profileScreen}
          contentContainerStyle={styles.profileScreenContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileTopBar}>
            <TouchableOpacity
              style={styles.profileTopBackButton}
              onPress={() => handleTabPress('home')}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-back" size={22} color="#4E433A" />
            </TouchableOpacity>
            <Text style={styles.profileTopTitle}>{t('status.home.profileTitle')}</Text>
            <View style={styles.profileTopSpacer} />
          </View>

          <View style={styles.profileHeader}>
            <TouchableOpacity
              style={styles.profileAvatar}
              onPress={() => void handleProfileAvatarPress()}
              activeOpacity={0.86}
              disabled={profileImageUploading}
            >
              {profileImageUrl && !profileImageLoadFailed ? (
                <Image
                  source={{ uri: profileImageUrl }}
                  style={styles.profileAvatarImage}
                  onError={() => setProfileImageLoadFailed(true)}
                />
              ) : cachedLocalImageUrl ? (
                <Image source={{ uri: cachedLocalImageUrl }} style={styles.profileAvatarImage} />
              ) : (
                <Text style={styles.profileAvatarText}>
                  {profileDisplayName.charAt(0).toUpperCase()}
                </Text>
              )}
              <View style={styles.profileAvatarBadge}>
                {profileImageUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={14} color="#fff" />
                )}
              </View>
            </TouchableOpacity>
          </View>
          <Text style={styles.profileName}>{profileDisplayName}</Text>
          <Text style={styles.profileEmail}>{currentAuth.email}</Text>

          <View style={styles.profileGroupCard}>
            <TouchableOpacity
              style={[styles.profileActionRow, styles.profileActionRowDivider]}
              onPress={() => setProfileEditModalVisible(true)}
              activeOpacity={0.85}
            >
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#E9F2EB' }]}>
                  <Ionicons name="person-circle-outline" size={20} color="#4A7C59" />
                </View>
                <Text style={styles.profileActionTitle}>{t('cta.home.profileEdit')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileActionRow, styles.profileActionRowDivider]}
              onPress={onOpenOrders}
              activeOpacity={0.85}
            >
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#E8EDF6' }]}>
                  <Ionicons name="receipt-outline" size={18} color="#5D7394" />
                </View>
                <View style={styles.profileActionTextBlock}>
                  <Text style={styles.profileActionTitle}>{t('cta.home.myOrders')}</Text>
                  <Text style={styles.profileActionSubtitle}>{t('helper.home.myOrdersHint')}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileActionRow, styles.profileActionRowDivider]}
              onPress={onOpenComplaints}
              activeOpacity={0.85}
            >
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#FCEFE7' }]}>
                  <Ionicons name="chatbubbles-outline" size={18} color="#B45C37" />
                </View>
                <View style={styles.profileActionTextBlock}>
                  <Text style={styles.profileActionTitle}>{t('headline.ticket.list')}</Text>
                  <Text style={styles.profileActionSubtitle}>{t('helper.settings.supportTicketsBody')}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </TouchableOpacity>
            {onOpenFavorites && (
            <TouchableOpacity
              style={[styles.profileActionRow, styles.profileActionRowDivider]}
              onPress={onOpenFavorites}
              activeOpacity={0.85}
            >
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#FDECEC' }]}>
                  <Ionicons name="heart-outline" size={18} color="#C0392B" />
                </View>
                <Text style={styles.profileActionTitle}>Favorilerim</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.profileActionRow}
              onPress={() => setAddressModalVisible(true)}
              activeOpacity={0.85}
            >
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#F1EADF' }]}>
                  <Ionicons name="location" size={18} color="#8B7255" />
                </View>
                <View style={styles.profileActionTextBlock}>
                  <Text style={styles.profileActionTitle}>{t('cta.home.deliveryAddressChange')}</Text>
                  <Text style={styles.profileActionSubtitle}>
                    {defaultAddress ? formatAddressLine(defaultAddress) : t('helper.home.deliveryAddressHint')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.profileGroupCard}
            onPress={onOpenSettings}
            activeOpacity={0.85}
          >
            <View style={styles.profileActionRow}>
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#EFEAE3' }]}>
                  <Ionicons name="shield-checkmark-outline" size={18} color="#6A5846" />
                </View>
                <Text style={styles.profileActionTitle}>{t('cta.home.security')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileGroupCard}
            onPress={() => setGeneralSettingsModalVisible(true)}
            activeOpacity={0.85}
          >
            <View style={styles.profileActionRow}>
              <View style={styles.profileActionMain}>
                <View style={[styles.profileActionIconWrap, { backgroundColor: '#EAF4ED' }]}>
                  <Ionicons name="options-outline" size={18} color="#3E845B" />
                </View>
                <Text style={styles.profileActionTitle}>{t('headline.home.generalSettingsTitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A79B8E" />
            </View>
          </TouchableOpacity>

          <View style={styles.profileSellerCard}>
            <View style={styles.profileSellerContent}>
              <View style={styles.profileSellerEmojiWrap}>
                <Text style={styles.profileSellerEmoji}>👨‍🍳</Text>
              </View>
              <View style={styles.profileSellerTextWrap}>
                <Text style={styles.profileSellerTitle}>{t('headline.home.profileSellerTitle')}</Text>
                <Text style={styles.profileSellerBody}>{t('helper.home.profileSellerBody')}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.profileSellerButton}
              onPress={onOpenSettings}
              activeOpacity={0.88}
            >
              <Text style={styles.profileSellerButtonText}>{t('cta.home.becomeSeller')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.profileLogoutButton}
            onPress={onLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.profileLogoutText}>{t('cta.home.logout')}</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return renderHomeFeed();
  }

  function renderChatMessage({ item }: { item: ChatMessage }) {
    if (item.isUser) {
      return (
        <View style={styles.chatRowUser}>
          <View style={styles.chatBubbleUser}>
            <Text style={styles.chatTextUser}>{item.text}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.chatRowBot}>
        <View style={styles.chatAvatar}>
          <Text style={styles.chatAvatarEmoji}>🧑‍🍳</Text>
        </View>
        <View style={styles.chatBubbleBot}>
          <Text style={styles.chatTextBot}>{item.text}</Text>
        </View>
      </View>
    );
  }

  /* ---------- Main render ---------- */
  const topChromeBg = activeTab === 'home' ? '#FDDEB7' : '#FFFBF4';

  return (
    <>
    <SafeAreaView style={[styles.safe, { backgroundColor: topChromeBg }]}>
      <StatusBar barStyle="dark-content" backgroundColor={topChromeBg} />
      {paymentError ? (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorBannerText}>{paymentError}</Text>
        </View>
      ) : null}

      <Modal
        visible={deliveryPinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeliveryPinModalVisible(false)}
      >
        <View style={styles.pinModalOverlay}>
          <TouchableOpacity style={styles.pinModalBackdrop} activeOpacity={1} onPress={() => setDeliveryPinModalVisible(false)} />
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>{t('headline.deliveryPin.title')}</Text>
            {deliveryPinLoading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : deliveryPinError ? (
              <Text style={styles.pinModalError}>{deliveryPinError}</Text>
            ) : !deliveryPinRecord ? (
              <>
                <Text style={styles.pinModalSub}>{t('headline.deliveryPin.emptyTitle')}</Text>
                <Text style={styles.pinModalHint}>{t('helper.deliveryPin.emptySubtitle')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.pinModalSub}>
                  {deliveryPinRecord.status === 'verified'
                    ? t('headline.deliveryPin.verified')
                    : t('headline.deliveryPin.pending')}
                </Text>
                <Text style={styles.pinModalHint}>
                  {deliveryPinRecord.status === 'verified'
                    ? t('helper.deliveryPin.verified')
                    : t('helper.deliveryPin.pending')}
                </Text>
                {deliveryPinRecord.status === 'pending' ? (
                  <View style={styles.pinModalCodeBox}>
                    <Text style={styles.pinModalCodeLabel}>{t('helper.deliveryPin.codeLabel')}</Text>
                    <Text style={styles.pinModalCode}>{deliveryPinRecord.pin ?? '-'}</Text>
                    <Text style={styles.pinModalAttempts}>
                      {formatCopy('helper.deliveryPin.attemptsRemaining', {
                        remaining: Math.max(0, 5 - Number(deliveryPinRecord.verificationAttempts ?? 0)),
                      })}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
            <View style={styles.pinModalActions}>
              <TouchableOpacity
                style={[styles.pinModalBtn, styles.pinModalCancelBtn]}
                activeOpacity={0.86}
                onPress={() => setDeliveryPinModalVisible(false)}
              >
                <Text style={styles.pinModalCancelText}>{t('cta.common.cancel')}</Text>
              </TouchableOpacity>
              {deliveryPinOrderId ? (
                <TouchableOpacity
                  style={[styles.pinModalBtn, styles.pinModalConfirmBtn]}
                  activeOpacity={0.86}
                  onPress={() => void fetchDeliveryProof(deliveryPinOrderId)}
                >
                  <Text style={styles.pinModalConfirmText}>{t('cta.payment.refresh')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={locationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setLocationModalVisible(false)}
          />
          <View style={styles.locationSheet}>
            <Text style={styles.locationSheetTitle}>Adres Seç</Text>
            <TouchableOpacity
              style={styles.locationSheetButton}
              activeOpacity={0.86}
              onPress={() => applyLocationSelection('current')}
            >
              <Text style={styles.locationSheetButtonText}>📍 Konumumu kullan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.locationSheetButton}
              activeOpacity={0.86}
              onPress={() => applyLocationSelection('home')}
            >
              <Text style={styles.locationSheetButtonText}>🏠 Ev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.locationSheetButton}
              activeOpacity={0.86}
              onPress={() => applyLocationSelection('work')}
            >
              <Text style={styles.locationSheetButtonText}>🏢 İş</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.locationSheetButton}
              activeOpacity={0.86}
              onPress={() => applyLocationSelection('new')}
            >
              <Text style={styles.locationSheetButtonText}>+ Yeni adres ekle</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={profileEditModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileEditModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setProfileEditModalVisible(false)}
          />
          <View style={styles.profileEditSheet}>
            <ProfileEditScreen
              auth={currentAuth}
              onBack={() => setProfileEditModalVisible(false)}
              onAuthRefresh={handleAuthRefresh}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={generalSettingsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGeneralSettingsModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setGeneralSettingsModalVisible(false)}
          />
          <View style={styles.generalSettingsSheet}>
            <View style={styles.generalSettingsHeader}>
              <Text style={styles.generalSettingsTitle}>{t('headline.home.generalSettingsTitle')}</Text>
              <TouchableOpacity
                style={styles.generalSettingsCloseBtn}
                onPress={() => setGeneralSettingsModalVisible(false)}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={18} color="#6B5D4F" />
              </TouchableOpacity>
            </View>
            <Text style={styles.generalSettingsBody}>{t('helper.home.generalSettingsBody')}</Text>
            <View style={styles.generalSettingsCard}>
              <Text style={styles.generalSettingsLabel}>{t('helper.home.generalSettingsLanguageLabel')}</Text>
              <Text style={styles.generalSettingsHint}>{t('helper.home.generalSettingsLanguageHint')}</Text>
              <View style={styles.generalSettingsLanguageRow}>
                <TouchableOpacity
                  style={[
                    styles.generalSettingsLanguageBtn,
                    appLanguage === 'tr' && styles.generalSettingsLanguageBtnActive,
                  ]}
                  onPress={() => void handleLanguageChange('tr')}
                  activeOpacity={0.9}
                >
                  <Text
                    style={[
                      styles.generalSettingsLanguageBtnText,
                      appLanguage === 'tr' && styles.generalSettingsLanguageBtnTextActive,
                    ]}
                  >
                    {t('cta.home.languageTurkish')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.generalSettingsLanguageBtn,
                    appLanguage === 'en' && styles.generalSettingsLanguageBtnActive,
                  ]}
                  onPress={() => void handleLanguageChange('en')}
                  activeOpacity={0.9}
                >
                  <Text
                    style={[
                      styles.generalSettingsLanguageBtnText,
                      appLanguage === 'en' && styles.generalSettingsLanguageBtnTextActive,
                    ]}
                  >
                    {t('cta.home.languageEnglish')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addressModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAddressModalVisible(false);
          void fetchUserAddresses();
        }}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => {
              setAddressModalVisible(false);
              void fetchUserAddresses();
            }}
          />
          <View style={styles.profileEditSheet}>
            <AddressScreen
              auth={currentAuth}
              onBack={() => {
                setAddressModalVisible(false);
                void fetchUserAddresses();
              }}
              onAuthRefresh={handleAuthRefresh}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={checkoutAddressModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCheckoutAddressModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setCheckoutAddressModalVisible(false)}
          />
          <View style={styles.checkoutAddressSheet}>
            <Text style={styles.checkoutAddressSheetTitle}>{t('headline.home.selectAddress')}</Text>
            <Text style={styles.checkoutAddressSheetSubtitle}>{t('helper.home.selectAddressSubtitle')}</Text>

            {addressesLoading ? (
              <View style={styles.checkoutAddressLoading}>
                <ActivityIndicator size="small" color="#3E845B" />
              </View>
            ) : userAddresses.length === 0 ? (
              <>
                <Text style={styles.checkoutAddressEmptyText}>{t('helper.home.addressListEmpty')}</Text>
                <TouchableOpacity
                  style={styles.checkoutAddressManageBtn}
                  onPress={() => {
                    setCheckoutAddressModalVisible(false);
                    setAddressModalVisible(true);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.checkoutAddressManageText}>{t('cta.address.add')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ScrollView style={styles.checkoutAddressList} showsVerticalScrollIndicator={false}>
                  {userAddresses.map((address) => {
                    const isSelected = selectedCheckoutAddress?.id === address.id;
                    return (
                      <TouchableOpacity
                        key={address.id}
                        style={[styles.checkoutAddressItem, isSelected && styles.checkoutAddressItemSelected]}
                        onPress={() => {
                          setSelectedCheckoutAddressId(address.id);
                          setCheckoutAddressModalVisible(false);
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={styles.checkoutAddressItemHead}>
                          <Text style={styles.checkoutAddressItemTitle}>{address.title}</Text>
                          {address.isDefault ? (
                            <View style={styles.checkoutAddressDefaultBadge}>
                              <Text style={styles.checkoutAddressDefaultText}>{t('status.address.default')}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.checkoutAddressItemLine} numberOfLines={2}>
                          {address.addressLine}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity
                  style={styles.checkoutAddressManageBtn}
                  onPress={() => {
                    setCheckoutAddressModalVisible(false);
                    setAddressModalVisible(true);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.checkoutAddressManageText}>{t('cta.home.manageAddresses')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Meal detail modal */}
      <Modal
        visible={!!selectedMeal}
        animationType={mealModalAnimType}
        transparent
        onRequestClose={() => setSelectedMeal(null)}
        onDismiss={() => setMealModalAnimType('slide')}
      >
        {selectedMeal && (
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFillObject}
              activeOpacity={1}
              onPress={() => setSelectedMeal(null)}
            />
            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setSelectedMeal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
              <View
                style={[
                  styles.modalThumb,
                  { backgroundColor: selectedMeal.backgroundColor },
                ]}
              >
                {selectedMeal.imageUrl ? (
                  <Image
                    source={{ uri: selectedMeal.imageUrl }}
                    style={styles.modalImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.modalEmoji}>🍽️</Text>
                )}
              </View>
              <Text style={styles.modalTitle}>{selectedMeal.title}</Text>
              <TouchableOpacity
                style={styles.modalSellerRow}
                activeOpacity={0.82}
                onPress={() => {
                  setSellerModalTouchGuardUntil(Date.now() + 350);
                  setSelectedSeller({
                    id: selectedMeal.sellerId,
                    name: selectedMeal.seller,
                    image: selectedMeal.sellerImage ?? null,
                  });
                }}
              >
                <Text style={styles.modalSeller}>{formatSellerIdentity(selectedMeal.seller, selectedMeal.sellerUsername)}</Text>
                <Ionicons name="chevron-forward" size={15} color="#7A8B6E" />
              </TouchableOpacity>
              {selectedMeal.cuisine ? (
                <Text style={styles.modalCuisine}>{formatCuisineLabel(selectedMeal.cuisine)}</Text>
              ) : null}
              {selectedMeal.locationBasisLabel ? (
                <Text style={styles.modalBasis}>{selectedMeal.locationBasisLabel}</Text>
              ) : null}
              <View style={styles.modalInfoRow}>
                <Text style={styles.modalRating}>★ {selectedMeal.rating}</Text>
                <Text style={styles.modalMeta}>
                  🕐 {selectedMeal.time} · {selectedMeal.distance}
                </Text>
              </View>
              {(() => {
                const freeNames = selectedMeal.addons
                  .filter((addon) => addon.pricing === 'free')
                  .map((addon) => addon.name.trim())
                  .filter(Boolean);
                const includedSidesText = freeNames.length > 0
                  ? `${selectedMeal.title}, ${Array.from(new Set(freeNames)).join(", ")}`
                  : "";
                const mergedIngredients = Array.from(
                  new Set(
                    [...selectedMeal.ingredients]
                      .map((item) => item.trim())
                      .filter(Boolean),
                  ),
                );
                const topText = mergedIngredients.join(', ');
                const bottomText = (selectedMeal.description ?? '').trim();
                if (!includedSidesText && !topText && !bottomText) return null;
                return (
                  <>
                    {includedSidesText ? (
                      <Text style={styles.modalDescription}>{includedSidesText}</Text>
                    ) : null}
                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>{t('headline.home.mealModal.ingredientsSpices')}</Text>
                      <Text style={styles.modalIngredientsPlain}>
                        {bottomText || topText}
                      </Text>
                    </View>
                  </>
                );
              })()}

              {selectedMeal.allergens.length > 0 && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{t('headline.home.mealModal.allergenWarning')}</Text>
                  <View style={styles.modalTagsWrap}>
                    {selectedMeal.allergens.map((a, i) => (
                      <View key={i} style={styles.modalAllergenTag}>
                        <Text style={styles.modalAllergenText}>{a}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {selectedMeal.addons.some((addon) => addon.pricing === 'paid' && Number(addon.price ?? 0) > 0) ? (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{t('headline.home.mealModal.paidAddons')}</Text>
                  <Text style={styles.modalSectionHint}>{t('helper.home.mealModal.paidAddonsHint')}</Text>
                  <View style={styles.modalPaidAddonsList}>
                    {selectedMeal.addons
                      .filter((addon) => addon.pricing === 'paid' && Number(addon.price ?? 0) > 0)
                      .map((addon, index) => {
                        const addonPrice = Number(addon.price ?? 0);
                        const selectedQuantity = selectedMealAddons.paid.find(
                          (item) => item.name === addon.name && item.kind === addon.kind && item.price === addonPrice,
                        )?.quantity ?? 0;
                        return (
                          <View key={`paid-addon-${addon.name}-${index}`} style={styles.modalPaidAddonRow}>
                            <View style={styles.modalPaidAddonInfo}>
                              <Text style={styles.modalPaidAddonName}>{addon.name}</Text>
                              <Text style={styles.modalPaidAddonMeta}>
                                +₺{addonPrice.toFixed(2)}
                              </Text>
                            </View>
                            <View style={styles.modalAddonStepper}>
                              <TouchableOpacity
                                style={styles.modalAddonStepperButton}
                                onPress={() => adjustSelectedPaidAddonQuantity(addon, -1)}
                                activeOpacity={0.85}
                              >
                                <Ionicons name="remove" size={14} color="#5F5246" />
                              </TouchableOpacity>
                              <Text style={styles.modalAddonStepperQty}>{selectedQuantity}</Text>
                              <TouchableOpacity
                                style={styles.modalAddonStepperButton}
                                onPress={() => adjustSelectedPaidAddonQuantity(addon, 1)}
                                activeOpacity={0.85}
                              >
                                <Ionicons name="add" size={14} color="#5F5246" />
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                  </View>
                </View>
              ) : null}

              <Text style={styles.modalPrice}>{selectedMeal.price}</Text>
              <TouchableOpacity
                style={styles.modalCartButton}
                activeOpacity={0.85}
                onPress={() => {
                  addMealToCart(selectedMeal, selectedMealAddons);
                  setSelectedMeal(null);
                }}
              >
                <Text style={styles.modalCartButtonText}>{t('cta.home.addToCart')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Agent modal */}
      <Modal
        visible={!!selectedSeller}
        animationType="none"
        transparent
        onRequestClose={closeSellerModal}
      >
        {selectedSeller ? (
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFillObject}
              activeOpacity={1}
              onPress={() => {
                if (Date.now() < sellerModalTouchGuardUntil) return;
                closeSellerModal();
              }}
            />
            <Animated.View
              style={[
                styles.sellerModalContent,
                { transform: [{ translateX: sellerModalSlideX }] },
              ]}
            >
              <TouchableOpacity
                style={styles.modalClose}
                onPress={closeSellerModal}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.sellerHeader}>
                <View style={styles.sellerAvatar}>
                  <Text style={styles.sellerAvatarEmoji}>👩‍🍳</Text>
                </View>
                <View style={styles.sellerHeaderText}>
                  <Text style={styles.sellerTitle}>{selectedSeller.name}</Text>
                  <Text style={styles.sellerSubtitle}>{t('status.home.sellerKitchen')}</Text>
                </View>
              </View>

              <View style={styles.sellerStatsRow}>
                <View style={styles.sellerStatCard}>
                  <Text style={styles.sellerStatValue}>{sellerMeals.length}</Text>
                  <Text style={styles.sellerStatLabel}>{t('label.home.sellerStat.meals')}</Text>
                </View>
                <View style={styles.sellerStatCard}>
                  <Text style={styles.sellerStatValue}>★ {sellerAverageRating}</Text>
                  <Text style={styles.sellerStatLabel}>{t('label.home.sellerStat.average')}</Text>
                </View>
              </View>
              {sellerProfile ? (
                <View style={styles.sellerAboutCard}>
                  <Text style={styles.sellerAboutTitle}>{t('headline.home.sellerBio')}</Text>
                  <Text style={styles.sellerAboutMeta}>
                    {t('status.home.sellerExperience')
                      .replace('{year}', String(sellerProfile.startedYear))
                      .replace('{years}', String(sellerProfile.experienceYears))}
                  </Text>
                  <Text style={styles.sellerAboutSales}>
                    {sellerCompletedMealsLoading
                      ? t('status.home.sellerSalesLoading')
                      : t('status.home.sellerTotalMealsSold').replace('{count}', String(sellerCompletedMealsSold ?? 0))}
                  </Text>
                  <Text style={styles.sellerAboutText}>{sellerProfile.bio}</Text>
                </View>
              ) : null}

              <Text style={styles.sellerSectionTitle}>{t('status.home.sellerReviews')}</Text>
              {sellerReviewsLoading ? (
                <View style={styles.sellerReviewsLoadingRow}>
                  <ActivityIndicator size="small" color="#4A7C59" />
                  <Text style={styles.sellerReviewsLoadingText}>{t('status.home.sellerReviewsLoading')}</Text>
                </View>
              ) : null}
              {sellerReviewsError ? (
                <Text style={styles.sellerReviewsErrorText}>{sellerReviewsError}</Text>
              ) : null}
              {!sellerReviewsLoading && !sellerReviewsError && sellerReviews.length === 0 ? (
                <Text style={styles.sellerEmptyReviewsText}>{t('helper.home.sellerReviewsEmpty')}</Text>
              ) : null}
              {!sellerReviewsLoading && !sellerReviewsError ? (
                <View style={styles.sellerReviewList}>
                  {sellerReviews.map((review) => (
                    <View key={review.id} style={styles.sellerReviewItem}>
                      <View style={styles.sellerReviewHead}>
                        <Text style={styles.sellerReviewBuyer}>{review.buyerName}</Text>
                        <View style={styles.sellerReviewRight}>
                          <View style={styles.sellerReviewStars}>
                            {[1, 2, 3, 4, 5].map((idx) => (
                              <Ionicons
                                key={`${review.id}-star-${idx}`}
                                name={idx <= review.rating ? 'star' : 'star-outline'}
                                size={13}
                                color="#D4A017"
                              />
                            ))}
                          </View>
                          <Text style={styles.sellerReviewDate}>{formatReviewDate(review.createdAt)}</Text>
                        </View>
                      </View>
                      <Text style={styles.sellerReviewFood}>{t('label.home.reviewFood').replace('{name}', review.foodName ?? '')}</Text>
                      <Text style={styles.sellerReviewComment}>
                        {review.comment?.trim() || t('helper.home.sellerCommentFallback')}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={styles.sellerSectionTitle}>{t('status.home.sellerMeals')}</Text>
              <View style={styles.sellerMealList}>
                {sellerMeals.map((meal) => (
                  <TouchableOpacity
                    key={meal.id}
                    style={styles.sellerMealItem}
                    activeOpacity={0.85}
                    onPress={() => openMealDetailFromSeller(meal)}
                  >
                    <View style={styles.sellerMealTextWrap}>
                      <Text style={styles.sellerMealTitle}>{meal.title}</Text>
                      <Text style={styles.sellerMealMeta}>
                        🕐 {meal.time} · {meal.distance}
                      </Text>
                    </View>
                    <View style={styles.sellerMealRight}>
                      <Text style={styles.sellerMealPrice}>{meal.price}</Text>
                      <Ionicons
                        name="chevron-forward-outline"
                        size={16}
                        color="#8D8072"
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              </ScrollView>
            </Animated.View>
          </View>
        ) : null}
      </Modal>

      {/* Cart toast */}
      <Animated.View style={[styles.cartToast, { opacity: cartToastOpacity }]} pointerEvents="none">
        <Text style={styles.cartToastText}>✓ {t('helper.home.toastAddedToList')}</Text>
      </Animated.View>

      {/* Main screen */}
      <View style={styles.container}>
          <View style={styles.content}>{renderContent()}</View>

          {/* FAB */}
          <View style={styles.floatingWrap}>
            <View pointerEvents="none" style={styles.pulseRing1} />
            <View pointerEvents="none" style={styles.pulseRing2} />
            <Animated.View
              style={{
                transform: [{ scale: breatheScale }],
              }}
            >
              <TouchableOpacity
                style={styles.floatingButton}
                activeOpacity={0.9}
                onPress={handleFabPress}
              >
                <Text style={styles.floatingButtonText}>C</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          {/* Bottom tab bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('home')}
            >
              <Ionicons
                name="home-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'home' && styles.navIconActive,
                ]}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'home' && styles.navLabelActive,
                ]}
              >
                {t('headline.home.tabHome')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('messages')}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'messages' && styles.navIconActive,
                ]}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'messages' && styles.navLabelActive,
                ]}
              >
                {t('headline.home.tabMessages')}
              </Text>
            </TouchableOpacity>
            <View style={styles.navSpacer} />
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('cart')}
            >
              <Ionicons
                name="basket-outline"
                size={21}
                style={[
                  styles.navIcon,
                  cartCount > 0 && styles.navIconFilled,
                  activeTab === 'cart' && styles.navIconActive,
                ]}
              />
              <Text
                style={[
                  styles.navLabel,
                  cartCount > 0 && styles.navLabelFilled,
                  activeTab === 'cart' && styles.navLabelActive,
                ]}
              >
                {t('headline.home.tabOrders')}{cartCount > 0 ? ` (${cartCount})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('notifications')}
            >
              <Ionicons
                name="notifications-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'notifications' && styles.navIconActive,
                ]}
              />
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'notifications' && styles.navLabelActive,
                ]}
              >
                {t('headline.home.tabNotifications')}
              </Text>
            </TouchableOpacity>
          </View>
      </View>
    </SafeAreaView>

    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Cart Payment Animation                                             */
/* ------------------------------------------------------------------ */

const CART_PAY_STEPS = [
  t('helper.home.processingCreateList'),
  t('helper.home.processingCapturePayment'),
  t('helper.home.processingSendSeller'),
  t('helper.home.processingDone'),
];

function CartPaymentAnimation({ onDone }: { onDone: () => void }) {
  const cardScale = useRef(new Animated.Value(0.7)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const stepOpacities = useRef(CART_PAY_STEPS.map(() => new Animated.Value(0))).current;
  const checkOpacities = useRef(CART_PAY_STEPS.map(() => new Animated.Value(0))).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const STEP_MS = 650;

    Animated.timing(bgOpacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();

    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, friction: 7, tension: 55, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();

    // Ripple loops
    const makeRipple = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(val, { toValue: 1, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          ]),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );

    const r1 = makeRipple(ripple1, 0);
    const r2 = makeRipple(ripple2, 500);
    r1.start();
    r2.start();

    // Dots
    const dotLoop = Animated.loop(
      Animated.stagger(180, [
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 260, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot2, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 260, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot3, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 260, useNativeDriver: true }),
        ]),
      ])
    );
    dotLoop.start();

    // Steps appear one by one
    const stepAnims = CART_PAY_STEPS.map((_, i) =>
      Animated.sequence([
        Animated.delay(i * STEP_MS),
        Animated.timing(stepOpacities[i], { toValue: 1, duration: 220, useNativeDriver: true }),
      ])
    );

    Animated.parallel(stepAnims).start(() => {
      // Check marks
      const checkAnims = CART_PAY_STEPS.map((_, i) =>
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(checkOpacities[i], { toValue: 1, duration: 180, useNativeDriver: true }),
        ])
      );
      Animated.parallel(checkAnims).start(() => {
        r1.stop();
        r2.stop();
        dotLoop.stop();

        // Show success icon
        Animated.parallel([
          Animated.spring(successScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
          Animated.timing(successOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        ]).start(() => {
          setTimeout(onDone, 900);
        });
      });
    });
  }, []);

  return (
    <Animated.View style={[cpStyles.overlay, { opacity: bgOpacity }]}>
      <View style={cpStyles.card}>
        {/* Ripple rings */}
        <View style={cpStyles.iconWrap}>
          {[ripple1, ripple2].map((r, i) => (
            <Animated.View
              key={i}
              style={[
                cpStyles.ripple,
                {
                  transform: [{ scale: Animated.add(new Animated.Value(1), Animated.multiply(r, new Animated.Value(0.7))) }],
                  opacity: Animated.subtract(new Animated.Value(0.3), Animated.multiply(r, new Animated.Value(0.3))),
                },
              ]}
            />
          ))}
          <Animated.View style={[cpStyles.iconCircle, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
            <Ionicons name="card" size={34} color="#fff" />
          </Animated.View>
        </View>

        <Text style={cpStyles.title}>{t('headline.home.processingTitle')}</Text>

        {/* Dots */}
        <View style={cpStyles.dots}>
          {[dot1, dot2, dot3].map((d, i) => (
            <Animated.View key={i} style={[cpStyles.dot, { opacity: d }]} />
          ))}
        </View>

        {/* Steps */}
        <View style={cpStyles.steps}>
          {CART_PAY_STEPS.map((label, i) => (
            <Animated.View key={i} style={[cpStyles.stepRow, { opacity: stepOpacities[i] }]}>
              <Animated.View style={{ opacity: checkOpacities[i] }}>
                <Ionicons name="checkmark-circle" size={17} color="#4A7C59" />
              </Animated.View>
              <Animated.View style={[cpStyles.stepDotEmpty, { opacity: Animated.subtract(new Animated.Value(1), checkOpacities[i]) }]} />
              <Text style={cpStyles.stepText}>{label}</Text>
            </Animated.View>
          ))}
        </View>

        {/* Success */}
        <Animated.View style={[cpStyles.successWrap, { opacity: successOpacity, transform: [{ scale: successScale }] }]}>
          <Ionicons name="checkmark-circle" size={52} color="#4A7C59" />
          <Text style={cpStyles.successText}>{t('headline.home.processingSuccess')}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const cpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 22, 14, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFDF9',
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    gap: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 20,
  },
  iconWrap: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  ripple: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#4A7C59',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#4A7C59',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A7C59',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    color: '#2F1F17',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  dots: { flexDirection: 'row', gap: 7, marginBottom: 24 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4A7C59' },
  steps: { width: '100%', gap: 11 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDotEmpty: {
    position: 'absolute',
    left: 0,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#C8BEB2',
  },
  stepText: { color: '#5B4D42', fontSize: 14, fontWeight: '500' },
  successWrap: { alignItems: 'center', gap: 6, marginTop: 20 },
  successText: { color: '#2F6F4A', fontSize: 16, fontWeight: '800' },
});

const styles = StyleSheet.create({
  /* --- Layout --- */
  safe: { flex: 1, backgroundColor: '#FDDEB7' },
  topErrorBanner: {
    backgroundColor: theme.error,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topErrorBannerText: {
    color: theme.onPrimary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  container: { flex: 1, backgroundColor: '#FFFBF4' },
  content: { flex: 1, zIndex: 10 },
  scroll: { flex: 1, backgroundColor: '#FDDEB7' },
  scrollContent: { paddingBottom: 130, backgroundColor: '#FFFBF4', minHeight: '100%' },

  /* --- Hero Header with Gradient + Food Image --- */
  heroWrap: {
    position: 'relative',
    height: 226,
    paddingHorizontal: 20,
    paddingTop: 8,
    marginLeft: -18,
    marginRight: -40,
    marginTop: 0,
    backgroundColor: '#FDDEB7',
    overflow: 'hidden',
  },
  heroBaseGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroFoodBgImg: {
    position: 'absolute',
    top: 0,
    right: -42,
    width: '82%',
    height: '100%',
    opacity: 1,
    resizeMode: 'cover',
  },
  heroFoodBgEdgeFade: {
    position: 'absolute',
    top: 16,
    right: -38,
    width: '64%',
    height: '78%',
    borderTopLeftRadius: 44,
    borderBottomLeftRadius: 44,
  },
  heroFeatherLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  heroFeatherTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: 78,
  },
  heroFeatherBottom: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100%',
    height: 96,
  },
  heroFeatherRight: {
    position: 'absolute',
    top: 0,
    right: -6,
    width: 24,
    height: '100%',
  },
  heroRightSeamCover: {
    ...StyleSheet.absoluteFillObject,
    left: undefined,
    width: 40,
    backgroundColor: '#FDDEB7',
  },
  heroTextArea: {
    zIndex: 3,
    width: '56%',
    paddingTop: 34,
    paddingBottom: 12,
    paddingLeft: 0,
  },
  heroIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroGreetingArea: {
    flexShrink: 1,
    minWidth: 0,
  },
  greetingTitleWrap: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', maxWidth: '100%' },
  greetingTitle: {
    color: '#1E1B18',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    color: '#B15735',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    lineHeight: 21,
  },
  heroLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
    alignSelf: 'flex-start',
  },
  heroLocationText: {
    color: '#B15735',
    fontSize: 12,
    fontWeight: '700',
  },
  heroAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E2E0DC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: '#fff',
    zIndex: 5,
    overflow: 'hidden',
    shadowColor: '#5A3E2B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  heroAvatarImage: { width: 44, height: 44, borderRadius: 22 },
  avatarEmoji: { fontSize: 24 },
  
  /* --- Sticky Search + Chips wrapper --- */
  stickySearchChips: {
    position: 'relative',
    backgroundColor: '#FFFBF4',
    paddingTop: 0,
    paddingBottom: 4,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  stickySearchFade: {
    ...StyleSheet.absoluteFillObject,
    height: 172,
  },

  /* --- Floating Search Bar (premium shadow) --- */
  floatingSearchWrap: {
    marginBottom: 14,
    marginHorizontal: 8,
    zIndex: 5,
  },
  floatingSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E6DED3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  floatingSearchBarActive: {
    borderWidth: 1,
    borderColor: '#E0D8CD',
  },
  floatingSearchInput: {
    flex: 1,
    color: '#3A281F',
    fontSize: 16,
    fontWeight: '400',
    paddingVertical: 4,
  },
  floatingSearchPlaceholder: {
    flex: 1,
    color: '#AFA79C',
    fontSize: 16,
    fontWeight: '400',
  },
  floatingSearchFilterBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* --- Category Chips --- */
  chipScroller: {
    marginBottom: 8,
    marginHorizontal: 0,
  },
  chipRow: {
    gap: 6,
    paddingHorizontal: 14,
    paddingRight: 18,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#DDD2C2',
  },
  chipActive: {
    backgroundColor: '#3C2920',
    borderColor: '#3C2920',
  },
  chipEmoji: {
    fontSize: 18,
    marginRight: 6,
  },
  chipText: {
    color: '#3D2B22',
    fontSize: 15,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* --- Nearby Signature Card --- */
  nearbyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8DCCB',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  nearbyHeaderCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nearbyHeaderTextWrap: {
    flexShrink: 1,
    gap: 2,
  },
  nearbyHeaderIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#4A7C59',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  nearbyHeaderSubtitle: {
    color: '#7E6D5D',
    fontSize: 14,
    fontWeight: '500',
  },
  nearbyHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  nearbyHeaderTitle: {
    color: '#3A281F',
    fontSize: 19,
    fontWeight: '700',
  },
  quickOrderPromoCard: {
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8DCCB',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  quickOrderCartCard: {
    borderWidth: 1,
    borderColor: '#E8DCCB',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  quickOrderScroller: {
    marginTop: 8,
    marginBottom: 12,
  },
  quickOrderScrollerContent: {
    paddingRight: 4,
  },
  quickOrderScrollCardHome: {
    width: Math.min(Dimensions.get('window').width - 44, 340),
    marginRight: 10,
    marginTop: 0,
    marginBottom: 0,
  },
  quickOrderScrollCardCart: {
    width: Math.min(Dimensions.get('window').width - 64, 320),
    marginRight: 10,
  },
  quickOrderScrollCardLast: {
    marginRight: 0,
  },
  quickOrderTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickOrderTitleBlock: { flex: 1, paddingRight: 6 },
  quickOrderEyebrow: { color: '#4A7C59', fontSize: 12, fontWeight: '800', marginBottom: 4 },
  quickOrderSeller: { color: '#3A281F', fontSize: 18, fontWeight: '800' },
  quickOrderMetaRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'nowrap' },
  quickOrderMeta: { color: '#8B7D6F', fontSize: 12, fontWeight: '700', marginTop: 2 },
  quickOrderMetaNo: { flexShrink: 1, marginTop: 0 },
  quickOrderMetaDate: { flexShrink: 0, marginTop: 0 },
  quickOrderLiveChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F3FAF5',
    borderWidth: 1,
    borderColor: '#CFE4D5',
  },
  quickOrderLiveChipWarn: {
    backgroundColor: '#FFF6E8',
    borderColor: '#EFD5A6',
  },
  quickOrderLiveChipAccent: {
    backgroundColor: '#EEF6FF',
    borderColor: '#C8DBF6',
  },
  quickOrderLiveChipText: {
    color: '#2F6F4A',
    fontSize: 12,
    fontWeight: '800',
  },
  quickOrderLiveChipTextWarn: {
    color: '#9A5A00',
  },
  quickOrderLiveChipTextAccent: {
    color: '#2A5C9A',
  },
  quickOrderMessageCard: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2D7C8',
    backgroundColor: '#FBF8F4',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickOrderMessageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickOrderMessageLabel: { color: '#2F6F4A', fontSize: 12, fontWeight: '800' },
  quickOrderMessageText: { color: '#5E5247', fontSize: 13, lineHeight: 18, marginTop: 6 },
  quickOrderItemsRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickOrderItems: { color: '#7A6D5D', fontSize: 12, lineHeight: 18, flex: 1, marginTop: 0 },
  quickOrderItemsPriceWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  quickOrderItemsDelivery: { color: '#8B7D6F', fontSize: 12, fontWeight: '700', maxWidth: 72 },
  quickOrderItemsPrice: { color: '#3A281F', fontSize: 16, fontWeight: '800' },
  quickOrderFooter: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  quickOrderPrice: { color: '#3A281F', fontSize: 16, fontWeight: '800', flexShrink: 0 },
  quickOrderActions: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 1,
  },
  quickOrderMainActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  quickOrderMainActionBtn: {
    flex: 1,
    height: 24,
    borderRadius: 8,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickOrderSecondaryBtn: {
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#CFE4D5',
    backgroundColor: '#F3FAF5',
    flexShrink: 1,
  },
  quickOrderSecondaryText: { color: '#2F6F4A', fontSize: 12, fontWeight: '800' },
  quickOrderPrimaryBtn: {
    backgroundColor: '#74A685',
    paddingHorizontal: 14,
    flexShrink: 1,
  },
  quickOrderPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pinModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pinModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pinModalCard: {
    borderRadius: 20,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E2D7C8',
    padding: 20,
  },
  pinModalTitle: {
    color: '#2E241C',
    fontWeight: '800',
    fontSize: 19,
    textAlign: 'center',
  },
  pinModalSub: {
    color: '#2F6F4A',
    fontWeight: '800',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 12,
  },
  pinModalHint: {
    color: '#6C6055',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 21,
  },
  pinModalError: {
    color: '#B42318',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  pinModalCodeBox: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2D7C8',
    backgroundColor: '#FBF8F4',
    padding: 16,
    alignItems: 'center',
  },
  pinModalCodeLabel: {
    color: '#71685F',
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  pinModalCode: {
    color: '#2E241C',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 8,
  },
  pinModalAttempts: {
    color: '#4A3B2F',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  pinModalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  pinModalBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pinModalCancelBtn: { backgroundColor: '#F6F1E8', borderColor: '#DCCFBF' },
  pinModalConfirmBtn: { backgroundColor: '#3F855C', borderColor: '#3F855C' },
  pinModalCancelText: { color: '#5B4F43', fontWeight: '700' },
  pinModalConfirmText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryOrdersBtn: {
    marginTop: 12,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD2C3',
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryOrdersBtnText: { color: '#5F5246', fontSize: 13, fontWeight: '700' },

  debugBox: {
    backgroundColor: '#FFF3CD',
    borderWidth: 1,
    borderColor: '#E8D9A8',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  headerDebugBox: {
    marginTop: 8,
    marginBottom: 0,
  },
  debugText: { color: '#5C4B1D', fontSize: 12, fontWeight: '500' },
  debugError: { color: '#B42318', fontSize: 12, fontWeight: '600', marginTop: 4 },

  /* --- Categories (legacy - kept for compat) --- */
  sellersSection: {
    marginBottom: 12,
    marginHorizontal: 12,
  },
  sellersSectionTitle: {
    color: '#3D2B22',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  recommendationsSection: {
    marginBottom: 22,
    marginHorizontal: 12,
    marginTop: 8,
  },
  recommendationsSectionTitle: {
    color: '#3A281F',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  recommendationsScroller: {
    marginHorizontal: -12,
    marginBottom: 8,
  },
  recommendationsRow: {
    gap: 8,
    paddingHorizontal: 14,
    paddingRight: 18,
  },
  sellersRow: {
    gap: 8,
    paddingRight: 6,
  },
  sellerChip: {
    minWidth: 232,
    maxWidth: 272,
    borderWidth: 1,
    borderColor: '#E8DCCB',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  sellerChipAvatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F2EBE1',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sellerChipAvatarImage: { width: '100%', height: '100%' },
  sellerChipAvatarEmoji: { fontSize: 18 },
  sellerChipTextWrap: { flex: 1, minWidth: 0 },
  sellerChipName: { color: '#3D3229', fontSize: 17, fontWeight: '700' },
  sellerChipMeta: { color: '#8D8072', fontSize: 14, marginTop: 3 },
  topSoldLoadingChip: {
    borderWidth: 1,
    borderColor: '#E8DCCB',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topSoldLoadingText: { color: '#7E7163', fontSize: 12, fontWeight: '600' },

  /* --- Food card --- */
  foodCardWrap: {
    marginBottom: 12,
    marginHorizontal: 10,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 6,
  },
  foodCard: {
    borderWidth: 1,
    borderRadius: 30,
    overflow: 'hidden',
    position: 'relative',
  },
  foodPhoto: {
    width: '100%',
    height: 180,
    overflow: 'hidden',
    backgroundColor: '#B96C44',
  },
  foodImageCarousel: {
    width: '100%',
    height: '100%',
  },
  foodImageCarouselContent: {
    height: '100%',
  },
  foodImageSlide: {
    height: '100%',
  },
  foodImage: {
    ...StyleSheet.absoluteFillObject,
  },
  foodImageFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#8E593C',
  },
  foodPhotoBottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 128,
  },
  foodPhotoBottomGradientFill: {
    ...StyleSheet.absoluteFillObject,
  },
  foodPhotoBottomGradientFallback: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 102,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  foodPhotoDotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    zIndex: 7,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  foodPhotoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  foodPhotoDotActive: {
    width: 16,
    borderRadius: 4,
    backgroundColor: '#F5D08A',
  },
  foodBadgesRight: {
    position: 'absolute',
    top: 14,
    right: 14,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 7,
  },
  foodRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(51,36,27,0.9)',
    borderRadius: 18,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  foodRatingBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  foodPhotoTitleOverlay: {
    position: 'absolute',
    left: 18,
    right: 16,
    bottom: 14,
    zIndex: 7,
  },
  foodPhotoTitleText: {
    color: '#FFFFFF',
    fontSize: 39,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -2,
    textShadowColor: 'rgba(0,0,0,0.72)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  foodPhotoTitleTextDark: {
    textShadowColor: 'rgba(255,255,255,0.60)',
    textShadowRadius: 7,
  },
  foodPhotoCuisineText: {
    marginTop: 1,
    color: '#F4ECE0',
    fontSize: 15,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  foodPhotoCuisineTextDark: {
    textShadowColor: 'rgba(255,255,255,0.55)',
    textShadowRadius: 4,
  },
  foodPriceBadge: {
    backgroundColor: 'rgba(51,36,27,0.9)',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  foodPriceBadgeText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  foodPhotoFavoriteBtn: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.48)',
    backgroundColor: 'rgba(76,56,42,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 7,
    shadowColor: '#1F130D',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  foodInfo: {
    backgroundColor: '#FAFAF8',
    borderTopWidth: 1,
    borderTopColor: 'rgba(125,95,71,0.1)',
    overflow: 'visible',
  },
  foodInfoContent: {
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
    overflow: 'visible',
  },
  foodInfoMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 21,
    marginBottom: 0,
  },
  foodInfoHalfCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  foodInfoLeadCol: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  foodInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  foodInfoColDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(112,88,68,0.16)',
    marginHorizontal: 10,
  },
  foodInfoRightCol: {
    width: '34%',
    flexShrink: 0,
    alignItems: 'flex-start',
    gap: 10,
  },
  foodInfoRightItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  foodInfoIconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3E6D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodInfoIconBubbleAlert: {
    backgroundColor: '#FBE8E4',
  },
  foodInfoIconBubbleOk: {
    backgroundColor: '#E4F2EB',
  },
  foodInfoTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  foodInfoTextWrapCentered: {
    minHeight: 30,
    justifyContent: 'center',
  },
  foodInfoAlertSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    justifyContent: 'flex-end',
  },
  foodInfoAlertTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  foodInfoAlertSpacer: {
    flex: 1,
    minWidth: 0,
  },
  foodInfoDividerGhost: {
    opacity: 0,
  },
  foodInfoInlineBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  foodInfoTitle: {
    color: '#433126',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
  },
  foodInfoSubtitle: {
    marginTop: 0,
    color: '#7B6758',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
  foodInfoAlertTitle: {
    color: '#B13B2E',
  },
  foodInfoOkTitle: {
    color: '#2F6F4A',
  },
  foodStatsRow: {
    marginTop: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 0,
  },
  foodStatItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  foodStatItemRightCol: {
    width: '34%',
    flexGrow: 0,
    flexShrink: 0,
  },
  foodStatIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F4EBE1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodStatTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  foodStatValue: {
    color: '#3E3025',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
  },
  foodStatLabel: {
    marginTop: 2,
    color: '#8B7768',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  foodStatDivider: {
    width: 1,
    backgroundColor: 'rgba(112,88,68,0.16)',
    marginHorizontal: 10,
    alignSelf: 'stretch',
    flexShrink: 0,
  },
  foodFooterRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(112,88,68,0.16)',
    marginTop: 6,
    paddingTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    overflow: 'visible',
  },
  foodFooterSeller: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    overflow: 'visible',
  },
  foodSellerThumbWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    position: 'relative',
    zIndex: 12,
    transform: [{ translateY: 0 }],
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  foodSellerThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 0.7,
    borderColor: 'rgba(141,128,114,0.24)',
    backgroundColor: '#F4EEE6',
  },
  foodSellerThumbImage: { width: '100%', height: '100%' },
  foodSellerThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodSellerThumbFallbackText: { color: '#6D5D50', fontSize: 18, fontWeight: '800' },
  foodFooterSellerText: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  foodFooterSellerHandle: {
    color: '#33241C',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  foodFooterSellerTagline: {
    marginTop: 1,
    color: '#7D695A',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  foodFooterFavoriteBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: '#DFAEAB',
    backgroundColor: '#FFF7F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodFooterFavoriteBtnActive: {
    backgroundColor: 'rgba(161,58,47,0.52)',
    borderColor: 'rgba(255,240,236,0.72)',
  },

  /* --- Tab panels --- */
  tabPanelCard: {
    marginTop: 24,
    marginHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FFFDF9',
    padding: 18,
  },
  tabPanelCardCompact: {
    marginTop: 24,
    marginHorizontal: 18,
  },
  tabPanelTitle: { color: '#3D3229', fontSize: 20, fontWeight: '700' },
  tabPanelText: { color: '#8D8072', fontSize: 14, marginTop: 8, lineHeight: 20 },
  cartWrap: { flex: 1, marginTop: 16, paddingHorizontal: 18 },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cartHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cartBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartHeaderCount: { color: '#8D8072', fontSize: 13, fontWeight: '600' },
  cartList: { flex: 1 },
  cartListContent: { paddingBottom: 14 },
  cartItemCard: {
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FFFDF9',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartItemTextWrap: { flex: 1, paddingRight: 8 },
  cartItemTitle: { color: '#3D3229', fontSize: 15, fontWeight: '700' },
  cartItemSeller: { color: '#8D8072', fontSize: 12, marginTop: 2 },
  cartAddonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 },
  cartAddonLine: { color: '#7A6D5D', fontSize: 11, marginTop: 3, lineHeight: 15 },
  cartAddonQtyRow: { flexDirection: 'row', alignItems: 'center' },
  cartAddonQtyBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#E6C9A7',
    backgroundColor: '#FBF2E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartAddonQtyText: { color: '#8A4B16', fontSize: 12, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  cartItemRight: { alignItems: 'flex-end' },
  cartItemPrice: { color: '#3D3229', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  cartItemTotal: { color: '#2E6B44', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  cartQtyRow: { flexDirection: 'row', alignItems: 'center' },
  cartQtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFD7CC',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartQtyText: { color: '#5F5246', fontSize: 13, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  cartFooter: {
    borderTopWidth: 1,
    borderTopColor: '#EDE8E0',
    paddingTop: 10,
    gap: 4,
  },
  cartBottomBar: {
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#F7F4EF',
  },
  cartDeliveryFeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartDeliveryFeeLabel: { color: '#8D8072', fontSize: 13, fontWeight: '600' },
  cartDeliveryFeeValue: { color: '#3D3229', fontSize: 15, fontWeight: '700' },
  cartTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartTotalLabel: { color: '#8D8072', fontSize: 13, fontWeight: '600' },
  cartTotalValue: { color: '#3D3229', fontSize: 20, fontWeight: '700' },
  checkoutAddressCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E6DDCF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#FFFBF5',
    gap: 10,
  },
  checkoutAddressTitle: { color: '#3D3229', fontSize: 13, fontWeight: '700' },
  deliveryTypeRow: { flexDirection: 'row', gap: 8 },
  deliveryTypeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#DDD2C3',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#FFFDF9',
  },
  deliveryTypeChipActive: {
    backgroundColor: '#4A7C59',
    borderColor: '#4A7C59',
  },
  deliveryTypeChipText: { color: '#5F5246', fontSize: 13, fontWeight: '700' },
  deliveryTypeChipTextActive: { color: '#FFFFFF' },
  checkoutAddressBox: {
    borderWidth: 1,
    borderColor: '#E8DED0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    padding: 10,
    gap: 6,
  },
  checkoutAddressLabel: { color: '#8D8072', fontSize: 12, fontWeight: '600' },
  checkoutAddressValue: { color: '#3D3229', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  checkoutAddressActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  checkoutAddressActionBtn: {
    borderWidth: 1,
    borderColor: '#DDD2C3',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#FFFDF9',
  },
  checkoutAddressActionText: { color: '#5F5246', fontSize: 12, fontWeight: '700' },
  checkoutAddressManageBtn: {
    borderWidth: 1,
    borderColor: '#4A7C59',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#EFF7F1',
  },
  checkoutAddressManageText: { color: '#2F6F4A', fontSize: 12, fontWeight: '700' },
  paymentStatusCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E6DDCF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFBF5',
  },
  paymentStatusTitle: { color: '#3D3229', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  paymentStatusText: { color: '#6B5D4F', fontSize: 12, lineHeight: 18 },
  paymentInfoText: { color: '#2F6F4A', fontSize: 12, fontWeight: '600', marginTop: 8 },
  paymentInfoTextCompact: { color: '#2F6F4A', fontSize: 12, fontWeight: '600', marginTop: 10, marginHorizontal: 18 },
  paymentActionsColumn: { gap: 8, marginTop: 10 },
  paymentActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  paymentActionBtn: {
    width: '100%',
    height: 42,
    borderRadius: 12,
    backgroundColor: '#4A7C59',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentActionBtnDisabled: { opacity: 0.65 },
  paymentActionBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  paymentSecondaryActionBtn: {
    width: '100%',
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4A7C59',
    backgroundColor: '#EFF7F1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  paymentSecondaryActionBtnText: { color: '#2F6F4A', fontSize: 13, fontWeight: '700' },
  paymentActionHintBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5D9CA',
    backgroundColor: '#FFFBF6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  paymentActionHint: {
    color: '#6B5D4F',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  paymentActionHintStrong: {
    color: '#3D3229',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 6,
  },
  paymentRefreshBtn: {
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#DDD2C3',
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRefreshBtnDisabled: { opacity: 0.55 },
  paymentRefreshBtnText: { color: '#5F5246', fontSize: 13, fontWeight: '700' },
  pendingBackHomeBtn: {
    marginTop: 18,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.buttonActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBackHomeBtnText: {
    color: theme.onPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  paymentWebSafe: { flex: 1, backgroundColor: '#FFFDF9' },
  paymentWebHeader: {
    height: 56,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentWebTitle: { color: '#3D3229', fontSize: 16, fontWeight: '700' },
  paymentWebClose: {
    borderWidth: 1,
    borderColor: '#DDD2C3',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FFF',
  },
  paymentWebCloseText: { color: '#5F5246', fontSize: 13, fontWeight: '700' },
  paymentWebLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  paymentWebErrorText: { color: '#B42318', fontSize: 14, fontWeight: '600' },
  paymentWebFallbackBtn: {
    marginTop: 10,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: '#4A7C59',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentWebFallbackBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  messagesTabWrap: { flex: 1, marginTop: 16, paddingBottom: 72 },
  messagesWallpaper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F7F3EC',
  },
  messagesBlob1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -70,
    right: -80,
    backgroundColor: 'rgba(74,124,89,0.10)',
  },
  messagesBlob2: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: 210,
    left: -100,
    backgroundColor: 'rgba(201,149,58,0.10)',
  },
  messagesBlob3: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: 40,
    right: -60,
    backgroundColor: 'rgba(109,93,79,0.08)',
  },
  messagesStripeA: {
    position: 'absolute',
    left: -30,
    right: -30,
    top: 80,
    height: 60,
    transform: [{ rotate: '-7deg' }],
  },
  messagesStripeB: {
    position: 'absolute',
    left: -40,
    right: -40,
    top: 220,
    height: 48,
    transform: [{ rotate: '5deg' }],
  },
  messagesStripeC: {
    position: 'absolute',
    left: -30,
    right: -30,
    top: 360,
    height: 68,
    transform: [{ rotate: '-6deg' }],
  },
  messagesGridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 26,
    right: 26,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  messagesGridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 130,
    height: 180,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  messagesGridSpot: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    bottom: 120,
    right: 40,
  },
  messagesRingA: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 16,
    top: -40,
    right: -90,
  },
  messagesRingB: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 12,
    top: 210,
    left: -80,
  },
  messagesRingC: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 10,
    bottom: 70,
    right: 26,
  },
  messagesDiagA: {
    position: 'absolute',
    width: 420,
    height: 120,
    transform: [{ rotate: '-28deg' }],
    top: 40,
    left: -130,
  },
  messagesDiagB: {
    position: 'absolute',
    width: 420,
    height: 88,
    transform: [{ rotate: '-28deg' }],
    top: 210,
    left: -110,
  },
  messagesDiagC: {
    position: 'absolute',
    width: 420,
    height: 70,
    transform: [{ rotate: '-28deg' }],
    top: 350,
    left: -95,
  },
  messagesCardA: {
    position: 'absolute',
    width: 180,
    height: 100,
    borderRadius: 18,
    top: 40,
    right: 30,
    transform: [{ rotate: '8deg' }],
  },
  messagesCardB: {
    position: 'absolute',
    width: 160,
    height: 90,
    borderRadius: 16,
    top: 200,
    left: 24,
    transform: [{ rotate: '-7deg' }],
  },
  messagesCardC: {
    position: 'absolute',
    width: 150,
    height: 84,
    borderRadius: 16,
    top: 340,
    right: 18,
    transform: [{ rotate: '6deg' }],
  },
  messagesWaveA: {
    position: 'absolute',
    left: -60,
    right: -60,
    top: 72,
    height: 110,
    borderRadius: 55,
  },
  messagesWaveB: {
    position: 'absolute',
    left: -80,
    right: -80,
    top: 230,
    height: 100,
    borderRadius: 50,
  },
  messagesWaveC: {
    position: 'absolute',
    left: -70,
    right: -70,
    top: 370,
    height: 90,
    borderRadius: 45,
  },
  messagesDotsA: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    top: 100,
    left: 44,
    shadowColor: '#000',
    shadowOpacity: 0.01,
    shadowRadius: 1,
    shadowOffset: { width: 1, height: 1 },
  },
  messagesDotsB: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: 230,
    right: 72,
  },
  messagesDotsC: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    top: 360,
    left: 130,
  },
  messagesSunsetSky: {
    position: 'absolute',
    top: 30,
    left: 24,
    right: 24,
    height: 130,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  messagesSunsetHorizon: {
    position: 'absolute',
    top: 160,
    left: 24,
    right: 24,
    height: 44,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  messagesSunsetSun: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    top: 112,
    left: '50%',
    marginLeft: -43,
  },
  messagesMinLineA: {
    position: 'absolute',
    left: 26,
    right: 26,
    top: 120,
    height: 2,
  },
  messagesMinLineB: {
    position: 'absolute',
    left: 56,
    right: 56,
    top: 250,
    height: 2,
  },
  messagesMinDot: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    top: 340,
    right: 42,
  },
  messagesTabHeader: { paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
  messagesWallpaperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#DFD7CC',
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  messagesTabHeaderText: { flex: 1 },
  messagesTabTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700' },
  messagesTabSubtitle: { color: '#8D8072', fontSize: 13, marginTop: 2 },

  /* --- Profile --- */
  profileScreen: { flex: 1 },
  profileScreenContent: { paddingTop: 18, paddingHorizontal: 18, paddingBottom: 124 },
  profileTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  profileTopBackButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTopTitle: { color: '#3D3229', fontSize: 16, fontWeight: '700' },
  profileTopSpacer: { width: 34, height: 34 },
  profileHeader: { alignItems: 'center', justifyContent: 'center' },
  profileAvatar: {
    width: 98,
    height: 98,
    borderRadius: 30,
    backgroundColor: '#EDE8E0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3F855C',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarImage: { width: '100%', height: '100%' },
  profileAvatarText: { fontSize: 34, color: '#4E433A', fontWeight: '700' },
  profileName: {
    color: '#3D3229',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  profileEmail: {
    color: '#8F8377',
    fontSize: 13,
    lineHeight: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  profileGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ECE4D9',
    marginBottom: 12,
    overflow: 'hidden',
  },
  profileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  profileActionRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEE6DB',
  },
  profileActionMain: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  profileActionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActionTextBlock: { flex: 1 },
  profileActionTitle: { color: '#4C4036', fontSize: 16, fontWeight: '700' },
  profileActionSubtitle: { color: '#8D8072', fontSize: 12, marginTop: 2 },
  profileSellerCard: {
    marginTop: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D5DDD1',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#F5F7F3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileSellerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  profileSellerEmojiWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF1EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  profileSellerEmoji: { fontSize: 20 },
  profileSellerTextWrap: { flex: 1 },
  profileSellerTitle: {
    color: '#2E2A26',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
  },
  profileSellerBody: { color: '#6D665E', fontSize: 13, lineHeight: 19, marginTop: 4 },
  profileSellerButton: {
    borderWidth: 1.5,
    borderColor: '#3D8758',
    backgroundColor: '#F4F8F2',
    borderRadius: 14,
    minWidth: 104,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  profileSellerButtonText: { color: '#3D8758', fontSize: 31 / 2, fontWeight: '800' },

  profileLogoutButton: {
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  profileLogoutText: { color: '#A04A4A', fontSize: 14, fontWeight: '600' },

  /* --- Inline error --- */
  inlineError: { color: '#D45454', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6 },

  /* --- FAB --- */
  floatingWrap: {
    position: 'absolute',
    left: '50%',
    bottom: Platform.OS === 'ios'
      ? -34 + ((BUYER_HOME_TAB_BAR_HEIGHT - 52) / 2)
      : ((BUYER_HOME_TAB_BAR_HEIGHT - 52) / 2),
    marginLeft: -26,
    zIndex: 80, width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
  },
  pulseRing1: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.2,
    borderColor: 'rgba(74,124,89,0.30)',
    backgroundColor: 'transparent',
  },
  pulseRing2: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.8,
    borderColor: 'rgba(74,124,89,0.18)',
    backgroundColor: 'transparent',
  },
  floatingButton: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#4A7C59',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4A7C59', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 18,
    elevation: 10,
  },
  floatingButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },

  /* --- Bottom bar --- */
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Platform.OS === 'ios' ? -34 : 0,
    height: BUYER_HOME_TAB_BAR_HEIGHT, backgroundColor: '#FFFDF9',
    borderTopWidth: 1, borderTopColor: '#EDE8E0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 2, paddingBottom: 0, paddingHorizontal: 8, zIndex: 50,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 0,
    paddingBottom: 0,
    transform: [{ translateY: 5 }],
  },
  navSpacer: { width: 72 },
  navIcon: { color: '#A89B8C', marginBottom: 3 },
  navIconFilled: { color: '#4A7C59' },
  navIconActive: { color: '#4A7C59' },
  navLabel: { color: '#A89B8C', fontSize: 12, lineHeight: 14, fontWeight: '600' },
  navLabelFilled: { color: '#4A7C59' },
  navLabelActive: { color: '#4A7C59' },

  /* --- Meal detail modal --- */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFFDF9', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '85%',
  } as const,
  modalScrollContent: {
    padding: 24, paddingBottom: 40, alignItems: 'center' as const,
  },
  modalClose: {
    position: 'absolute', top: 16, right: 20,
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#EDE8E0',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  modalCloseText: { color: '#6B5D4F', fontSize: 16, fontWeight: '700' },
  modalThumb: { width: '100%' as unknown as number, height: 200, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 16, overflow: 'hidden' as const },
  modalImage: { width: '100%' as unknown as number, height: '100%' as unknown as number },
  modalEmoji: { fontSize: 56 },
  modalTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  modalSellerRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  modalSeller: { color: '#7A8B6E', fontSize: 16, fontWeight: '600' },
  modalCuisine: { color: '#A89B8C', fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  modalBasis: { color: '#5E7C69', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  modalInfoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginBottom: 8 },
  modalRating: { color: '#C4953A', fontSize: 14, fontWeight: '700' },
  modalMeta: { color: '#A89B8C', fontSize: 13 },
  modalDescription: { color: '#6B5D4F', fontSize: 14, lineHeight: 20, textAlign: 'center' as const, marginBottom: 12, marginTop: 4 },
  modalSection: { width: '100%' as unknown as number, marginBottom: 12 },
  modalSectionTitle: { color: '#3D3229', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  modalSectionHint: { color: '#7A6D61', fontSize: 12.5, marginBottom: 8 },
  modalTagsWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  modalPaidAddonsList: { gap: 10 },
  modalPaidAddonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5DDCF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFCF6',
  },
  modalPaidAddonInfo: { flex: 1, paddingRight: 8 },
  modalPaidAddonName: { color: '#3D3229', fontSize: 14, fontWeight: '700' },
  modalPaidAddonMeta: { color: '#7A6D61', fontSize: 12, marginTop: 2 },
  modalAddonStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalAddonStepperButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7CCBE',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAddonStepperQty: { minWidth: 20, textAlign: 'center', color: '#3D3229', fontSize: 14, fontWeight: '700' },
  modalAddonsWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  modalAddonChip: {
    borderWidth: 1,
    borderColor: '#D8CEBF',
    borderRadius: 999,
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modalAddonChipSelected: {
    borderColor: '#3E845B',
    backgroundColor: '#EAF4EC',
  },
  modalAddonChipText: { color: '#5E5247', fontSize: 12, fontWeight: '600' },
  modalAddonChipTextSelected: { color: '#2E6B44', fontWeight: '700' },
  modalIngredientsPlain: { color: '#5F5246', fontSize: 14, lineHeight: 20 },
  modalAllergenTag: { backgroundColor: '#FDECEA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#F5C6CB' },
  modalAllergenText: { color: '#DC3545', fontSize: 13, fontWeight: '600' },
  allergenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  allergenModal: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', gap: 10 },
  allergenIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  allergenModalTitle: { fontSize: 18, fontWeight: '800', color: '#C0392B' },
  allergenModalBody: { fontSize: 14, color: '#5F5246' },
  allergenModalList: { fontSize: 15, fontWeight: '700', color: '#C0392B' },
  allergenModalQuestion: { fontSize: 14, color: '#5F5246', marginTop: 4 },
  allergenModalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  allergenCancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, backgroundColor: '#F0EBE4', alignItems: 'center' },
  allergenCancelText: { fontSize: 15, fontWeight: '600', color: '#71685F' },
  allergenAddBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, backgroundColor: '#C0392B', alignItems: 'center' },
  allergenAddText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalPrice: { color: '#5B7A4A', fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  modalCartButton: {
    backgroundColor: '#4A7C59', borderRadius: 16, paddingVertical: 16,
    paddingHorizontal: 48, width: '100%' as unknown as number, alignItems: 'center' as const,
  },
  modalCartButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  /* --- Seller modal --- */
  sellerModalContent: {
    backgroundColor: '#FFFDF9',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    maxHeight: '82%',
  },
  sellerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sellerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#EFE9E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sellerAvatarEmoji: { fontSize: 28 },
  sellerHeaderText: { flex: 1, paddingRight: 34 },
  sellerTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700' },
  sellerSubtitle: { color: '#8D8072', fontSize: 13, fontWeight: '600', marginTop: 2 },
  sellerStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  sellerStatCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FAF7F2',
    paddingVertical: 10,
    alignItems: 'center',
  },
  sellerStatValue: { color: '#3D3229', fontSize: 18, fontWeight: '700' },
  sellerStatLabel: { color: '#8D8072', fontSize: 12, fontWeight: '600', marginTop: 2 },
  sellerAboutCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FAF7F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  sellerAboutTitle: { color: '#3D3229', fontSize: 13, fontWeight: '700' },
  sellerAboutMeta: { color: '#7E7163', fontSize: 12, fontWeight: '600', marginTop: 3 },
  sellerAboutSales: { color: '#4A7C59', fontSize: 12, fontWeight: '700', marginTop: 4 },
  sellerAboutText: { color: '#6E6256', fontSize: 12, lineHeight: 18, marginTop: 5 },
  sellerReviewList: { marginBottom: 12 },
  sellerReviewsLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sellerReviewsLoadingText: { color: '#7E7163', fontSize: 12, fontWeight: '600' },
  sellerReviewsErrorText: { color: '#B42318', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  sellerEmptyReviewsText: { color: '#8D8072', fontSize: 12, marginBottom: 10 },
  sellerReviewItem: {
    borderWidth: 1,
    borderColor: '#EDE8E0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  sellerReviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sellerReviewBuyer: { color: '#3D3229', fontSize: 13, fontWeight: '700', flex: 1, paddingRight: 8 },
  sellerReviewRight: { alignItems: 'flex-end' },
  sellerReviewStars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  sellerReviewDate: { color: '#8D8072', fontSize: 10, marginTop: 2 },
  sellerReviewFood: { color: '#7E7163', fontSize: 11, marginBottom: 3 },
  sellerReviewComment: { color: '#5F5246', fontSize: 12, lineHeight: 17 },
  sellerSectionTitle: {
    color: '#3D3229',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 2,
  },
  sellerMealList: {},
  sellerMealItem: {
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sellerMealTextWrap: { flex: 1, paddingRight: 8 },
  sellerMealTitle: { color: '#3D3229', fontSize: 15, fontWeight: '600' },
  sellerMealMeta: { color: '#8D8072', fontSize: 12, marginTop: 2 },
  sellerMealRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sellerMealPrice: { color: '#3D3229', fontSize: 15, fontWeight: '700' },
  profileEditOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  profileEditBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  profileEditSheet: {
    height: '82%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFDF9',
  },
  generalSettingsSheet: {
    marginHorizontal: 18,
    marginBottom: 36,
    borderRadius: 22,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#ECE4D9',
    padding: 18,
  },
  generalSettingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  generalSettingsTitle: {
    color: '#3D3229',
    fontSize: 18,
    fontWeight: '800',
  },
  generalSettingsCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4EFE8',
  },
  generalSettingsBody: {
    color: '#6D665E',
    fontSize: 13,
    lineHeight: 20,
  },
  generalSettingsCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ECE4D9',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  generalSettingsLabel: {
    color: '#3D3229',
    fontSize: 14,
    fontWeight: '700',
  },
  generalSettingsHint: {
    color: '#8D8072',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  generalSettingsLanguageRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  generalSettingsLanguageBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDD2C3',
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generalSettingsLanguageBtnActive: {
    backgroundColor: theme.buttonActive,
    borderColor: theme.buttonActive,
  },
  generalSettingsLanguageBtnText: {
    color: '#5F5246',
    fontSize: 14,
    fontWeight: '700',
  },
  generalSettingsLanguageBtnTextActive: {
    color: theme.onPrimary,
  },
  checkoutAddressSheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 20,
  },
  checkoutAddressSheetTitle: { color: '#38261D', fontSize: 20, fontWeight: '800' },
  checkoutAddressSheetSubtitle: { color: '#7D6B5B', fontSize: 13, marginTop: 4, marginBottom: 12 },
  checkoutAddressLoading: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  checkoutAddressEmptyText: { color: '#7D6B5B', fontSize: 14, marginBottom: 10 },
  checkoutAddressList: { maxHeight: 320, marginBottom: 10 },
  checkoutAddressItem: {
    borderWidth: 1,
    borderColor: '#E6DDCF',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  checkoutAddressItemSelected: {
    borderColor: '#4A7C59',
    backgroundColor: '#F3FAF5',
  },
  checkoutAddressItemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  checkoutAddressItemTitle: { color: '#3D3229', fontSize: 14, fontWeight: '700', flex: 1 },
  checkoutAddressItemLine: { color: '#7A6C5D', fontSize: 12, lineHeight: 18, marginTop: 3 },
  checkoutAddressDefaultBadge: {
    backgroundColor: '#E5F2E8',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  checkoutAddressDefaultText: { color: '#2F6F4A', fontSize: 11, fontWeight: '700' },
  locationSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  locationSheetTitle: {
    color: '#38261D',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  locationSheetButton: {
    backgroundColor: '#FCF8EE',
    borderWidth: 1,
    borderColor: '#E8E1D9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  locationSheetButtonText: {
    color: '#5A3E2B',
    fontSize: 16,
    fontWeight: '600',
  },

  /* --- Agent modal --- */
  agentModalSafe: { flex: 1, backgroundColor: '#F5F1EB' },
  agentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  agentCloseBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  agentHeaderTitle: { fontSize: 15, fontWeight: '600', color: '#3D3229' },
  modePill: { backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 3, flexDirection: 'row' },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10 },
  modeBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  modeBtnText: { color: '#A89B8C', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: '#3D3229' },
  agentContent: { flex: 1 },
  agentCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  agentStatusText: { color: '#3D3229', fontSize: 16, fontWeight: '600' },
  agentErrorText: { color: '#D45454', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  agentRetryBtn: { backgroundColor: '#4A7C59', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  agentRetryText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  /* --- Chat (text mode) --- */
  chatListContainer: { flex: 1 },
  chatList: { padding: 16, paddingBottom: 8 },
  chatRowBot: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 8 },
  chatAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EDE8E0', alignItems: 'center', justifyContent: 'center' },
  chatAvatarEmoji: { fontSize: 14 },
  chatBubbleBot: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderTopLeftRadius: 4,
    paddingHorizontal: 13, paddingVertical: 10, maxWidth: '75%',
  },
  chatTextBot: { color: '#3D3229', fontSize: 14, lineHeight: 20 },
  chatRowUser: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  chatBubbleUser: {
    backgroundColor: '#4A7C59', borderRadius: 16, borderTopRightRadius: 4,
    paddingHorizontal: 13, paddingVertical: 10, maxWidth: '75%',
  },
  chatTextUser: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  chatInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#EDE8E0',
  },
  chatMicBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  chatTextInput: {
    flex: 1, borderWidth: 1, borderColor: '#DDD7CC', borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 10, color: '#3D3229', fontSize: 14,
  },
  chatSendBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#4A7C59',
    alignItems: 'center', justifyContent: 'center',
  },
  cartToast: {
    position: 'absolute', bottom: 100, alignSelf: 'center',
    backgroundColor: '#3D3229', borderRadius: 24,
    paddingHorizontal: 20, paddingVertical: 12,
    zIndex: 9999, elevation: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  cartToastText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
