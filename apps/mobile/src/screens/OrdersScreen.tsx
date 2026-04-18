import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge, { getStatusInfo } from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import { t } from '../copy/brandCopy';
import { theme } from '../theme/colors';
import { formatPrice, orderNo } from '../components/OrderCard';
import { apiRequest } from '../utils/api';
import { type AuthSession } from '../utils/auth';

type ApiOrder = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress: unknown;
  totalPrice: number;
  createdAt: string;
  updatedAt?: string;
  sellerName: string;
  sellerImage: string | null;
  buyerName: string;
  orderNo?: string | null;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

type BuyerOrderSummary = {
  id: string;
  orderNo?: string | null;
  status: string;
  sellerName: string;
  items: { name: string; quantity: number }[];
  totalPrice: number;
  createdAt: string;
  updatedAt?: string;
  deliveryType: 'pickup' | 'delivery';
};

type Props = {
  auth: AuthSession;
  title?: string;
  emptyTitle?: string;
  emptySubtitle?: string;
  onBack: () => void;
  onOpenOrderDetail: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type OrderGroupKey = 'preparing' | 'route' | 'done';

const DONE_STATUSES = new Set(['delivered', 'completed', 'cancelled', 'rejected']);
const ROUTE_STATUSES = new Set(['in_delivery', 'approaching', 'at_door']);

function parseApiDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(' ', 'T').replace(/(\.\d+)?([+-]\d{2})$/, '$1$2:00');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatOrderDateTime(value?: string): string {
  const parsed = parseApiDate(value);
  if (!parsed) return '-';
  const day = parsed.getDate().toString().padStart(2, '0');
  const month = (parsed.getMonth() + 1).toString().padStart(2, '0');
  const hours = parsed.getHours().toString().padStart(2, '0');
  const minutes = parsed.getMinutes().toString().padStart(2, '0');
  return `${day}.${month} / ${hours}:${minutes}`;
}

function orderTimeForSort(order: BuyerOrderSummary): number {
  return (parseApiDate(order.createdAt) ?? parseApiDate(order.updatedAt))?.getTime() ?? 0;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDisplayStatus(status: string, deliveryType?: string): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized === 'completed') return 'delivered';
  if (normalized === 'ready' && deliveryType === 'delivery') return 'in_delivery';
  return normalized;
}

function orderGroupKey(status: string, deliveryType?: string): OrderGroupKey {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  if (ROUTE_STATUSES.has(normalized)) return 'route';
  if (DONE_STATUSES.has(normalized)) return 'done';
  return 'preparing';
}

function getDisplayOrderNo(order: BuyerOrderSummary): string {
  const raw = String(order.orderNo ?? '').trim();
  return raw ? raw : orderNo(order.id);
}

function getItemsLine(order: BuyerOrderSummary): string {
  return order.items.map((item) => `${item.quantity}x ${item.name}`).join(' · ');
}

function matchesQuery(order: BuyerOrderSummary, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = normalizeText([
    order.sellerName,
    getDisplayOrderNo(order),
    order.items.map((item) => item.name).join(' '),
  ].join(' '));
  return haystack.includes(normalizeText(query));
}

function cardTone(status: string, deliveryType?: string) {
  const normalized = normalizeDisplayStatus(status, deliveryType);
  const info = getStatusInfo(normalized, deliveryType);
  const borders: Record<string, string> = {
    pending_buyer_confirmation: '#C4B5FD',
    pending_seller_approval: '#F0C37E',
    seller_approved: '#E7C88F',
    awaiting_payment: '#ECD98C',
    paid: '#9BD7D0',
    preparing: '#E3C9A5',
    ready: '#AFCFB2',
    in_delivery: '#B7C9EA',
    approaching: '#A6D8D6',
    at_door: '#D6B18C',
    delivered: '#B4D2BC',
    cancelled: '#E8C1BC',
    rejected: '#E8C1BC',
  };

  return {
    badgeBg: info.bg,
    badgeText: info.color,
    border: borders[normalized] ?? '#E5DDCF',
    actionBg: info.bg,
    actionText: info.color,
  };
}

export default function OrdersScreen({
  auth,
  title = t('headline.orders.title'),
  emptyTitle = t('headline.orders.emptyTitle'),
  emptySubtitle = t('helper.orders.emptySubtitle'),
  onBack,
  onOpenOrderDetail,
  onAuthRefresh,
}: Props) {
  const [orders, setOrders] = useState<BuyerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOrders = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    let result = await apiRequest<ApiOrder[]>(
      '/v1/orders/?pageSize=100&sortDir=desc&role=buyer',
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );

    if (!result.ok) {
      result = await apiRequest<ApiOrder[]>(
        '/v1/orders/?page=1&pageSize=100&sortDir=desc&role=buyer',
        auth,
        { actorRole: 'buyer' },
        onAuthRefresh,
      );
    }

    if (result.ok) {
      try {
        const mapped = (result.data as unknown as ApiOrder[]).map((order: ApiOrder) => ({
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          sellerName: order.sellerName ?? t('status.orders.sellerFallback'),
          items: Array.isArray(order.items)
            ? order.items.map((item) => ({ name: item.name, quantity: item.quantity }))
            : [],
          totalPrice: Number(order.totalPrice ?? 0),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          deliveryType: order.deliveryType,
        }));
        setOrders(mapped);
      } catch {
        setError(t('error.orders.load'));
      }
    } else {
      setError(result.message ?? t('error.orders.load'));
    }

    setLoading(false);
    setRefreshing(false);
  }, [auth, onAuthRefresh]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOrders(true);
  };

  const filteredOrders = useMemo(
    () => orders.filter((order) => matchesQuery(order, searchQuery)),
    [orders, searchQuery],
  );

  const groupedOrders = useMemo(() => {
    const preparing: BuyerOrderSummary[] = [];
    const route: BuyerOrderSummary[] = [];
    const done: BuyerOrderSummary[] = [];

    for (const order of filteredOrders) {
      const key = orderGroupKey(order.status, order.deliveryType);
      if (key === 'preparing') preparing.push(order);
      else if (key === 'route') route.push(order);
      else done.push(order);
    }

    preparing.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    route.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    done.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));

    return { preparing, route, done };
  }, [filteredOrders]);

  const newestActiveOrderId = useMemo(() => {
    const activeOrders = [...groupedOrders.preparing, ...groupedOrders.route];
    activeOrders.sort((a, b) => orderTimeForSort(b) - orderTimeForSort(a));
    return activeOrders[0]?.id ?? null;
  }, [groupedOrders]);

  const hasSearch = searchQuery.trim().length > 0;
  const hasAnyOrders = orders.length > 0;
  const hasSearchResults = filteredOrders.length > 0;

  const sections = [
    { key: 'preparing' as const, title: t('headline.orders.preparingTitle'), data: groupedOrders.preparing },
    { key: 'route' as const, title: t('headline.orders.routeTitle'), data: groupedOrders.route },
    { key: 'done' as const, title: t('headline.orders.historyTitle'), data: groupedOrders.done },
  ];

  function renderOrderCard(order: BuyerOrderSummary) {
    const tone = cardTone(order.status, order.deliveryType);
    const isNewest = order.id === newestActiveOrderId && orderGroupKey(order.status, order.deliveryType) !== 'done';
    const isPendingProposal = order.status === 'pending_buyer_confirmation';

    return (
      <TouchableOpacity
        key={order.id}
        activeOpacity={0.88}
        onPress={() => onOpenOrderDetail(order.id)}
        style={styles.orderCard}
      >
        {isNewest ? <View style={styles.newHighlightLayer} /> : null}

        <View style={styles.orderTopRow}>
          <View style={styles.orderTitleWrap}>
            <View style={styles.orderTitleRow}>
              <Text style={styles.orderTitle} numberOfLines={1}>{order.sellerName}</Text>
              {isNewest ? (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>{t('status.orders.newBadge')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.orderMeta} numberOfLines={2}>
              {getItemsLine(order) || t('helper.orders.itemsFallback')}
            </Text>
          </View>

          <View style={styles.orderTopRight}>
            <Text style={styles.orderTopDeliveryType}>
              {order.deliveryType === 'delivery'
                ? t('status.orders.deliveryType.delivery')
                : t('status.orders.deliveryType.pickup')}
            </Text>
            <Text style={styles.orderIdText}>{getDisplayOrderNo(order)}</Text>
            <Text style={styles.orderDateText}>{formatOrderDateTime(order.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.orderBottomRow}>
          <View style={styles.orderBottomLeft}>
            <StatusBadge status={order.status} deliveryType={order.deliveryType} audience="buyer" />
            {isPendingProposal ? (
              <View style={styles.proposalPendingPill}>
                <Text style={styles.proposalPendingPillText}>{t('status.orders.proposalPendingPill')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.orderTotal}>{formatPrice(order.totalPrice)}</Text>
        </View>
        {isPendingProposal ? (
          <View style={styles.proposalPendingBanner}>
            <Ionicons name="time-outline" size={15} color="#7C3AED" />
            <Text style={styles.proposalPendingBannerText}>{t('helper.orders.proposalPendingSubtitle')}</Text>
          </View>
        ) : null}

        <View style={styles.cardActionRow}>
          <View
            style={[
              styles.cardActionBtn,
              {
                backgroundColor: tone.actionBg,
                borderColor: tone.border,
              },
            ]}
          >
            <Text style={[styles.cardActionText, { color: tone.actionText }]}>
              {t('cta.orders.openDetail')}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={title} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('helper.orders.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchOrders()} />
      ) : !hasAnyOrders ? (
        <EmptyState icon="receipt-outline" title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />
          }
        >
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={20} color="#6B4D3A" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('helper.orders.searchPlaceholder')}
              placeholderTextColor="#AA9C8E"
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setSearchQuery('')}
                style={styles.clearSearchButton}
              >
                <Ionicons name="close-outline" size={20} color="#6B4D3A" />
              </TouchableOpacity>
            ) : (
              <View style={styles.searchActionIcon}>
                <Ionicons name="options-outline" size={18} color="#6B4D3A" />
              </View>
            )}
          </View>

          {hasSearch && !hasSearchResults ? (
            <EmptyState
              icon="search-outline"
              title={t('helper.orders.searchEmptyTitle')}
              subtitle={t('helper.orders.searchEmptySubtitle')}
            />
          ) : (
            sections
              .filter((section) => !hasSearch || section.data.length > 0)
              .map((section) => (
                <View key={section.key} style={styles.groupSection}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle}>{section.title}</Text>
                    <Text style={styles.groupCount}>{section.data.length}</Text>
                  </View>

                  {section.data.length === 0 ? (
                    <View style={styles.groupEmptyCard}>
                      <Text style={styles.groupEmptyText}>{t('helper.orders.groupEmpty')}</Text>
                    </View>
                  ) : (
                    section.data.map(renderOrderCard)
                  )}
                </View>
              ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, paddingBottom: 40 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E0D8CD',
    backgroundColor: '#FFF8F1',
    paddingLeft: 16,
    paddingRight: 8,
    shadowColor: '#3D3229',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 14,
  },
  clearSearchButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E9DC',
  },
  searchActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E9DC',
  },
  groupSection: { marginTop: 24 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  groupTitle: { color: '#3F3126', fontSize: 16, fontWeight: '800' },
  groupCount: { color: '#6A5A4B', fontSize: 14, fontWeight: '800' },
  groupEmptyCard: {
    backgroundColor: '#FCFAF7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ECE3D7',
    padding: 10,
    marginBottom: 8,
  },
  groupEmptyText: { color: '#8A7A6B', fontWeight: '600' },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  newHighlightLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#8FD9A8',
    opacity: 0.18,
  },
  orderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  orderTitleWrap: { flex: 1, paddingRight: 8 },
  orderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderTitle: { color: '#4A3B2F', fontWeight: '800', fontSize: 16, flex: 1 },
  newBadge: {
    borderRadius: 999,
    backgroundColor: '#157347',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  newBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  orderMeta: { color: '#6C6055', marginTop: 4, lineHeight: 19 },
  orderTopRight: { alignItems: 'flex-end', minWidth: 108 },
  orderTopDeliveryType: { color: '#2F6F4A', fontSize: 12, fontWeight: '800' },
  orderIdText: { color: '#887766', fontSize: 12, fontWeight: '800' },
  orderDateText: { color: '#9A8A7A', fontSize: 11, fontWeight: '700', marginTop: 2 },
  orderBottomRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  orderBottomLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  proposalPendingPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DCCCF8',
    backgroundColor: '#F7F2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  proposalPendingPillText: { color: '#6D28D9', fontSize: 11, fontWeight: '800' },
  proposalPendingBanner: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCCCF8',
    backgroundColor: '#F7F2FF',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  proposalPendingBannerText: { flex: 1, color: '#6D28D9', fontSize: 12, fontWeight: '700', lineHeight: 18 },
  orderTotal: { color: '#4A3B2F', fontWeight: '900', fontSize: 16 },
  cardActionRow: { marginTop: 14 },
  cardActionBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cardActionText: { fontWeight: '800', fontSize: 13 },
});
