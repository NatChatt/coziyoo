import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import { t } from '../copy/brandCopy';
import { theme } from '../theme/colors';
import { apiRequest } from '../utils/api';
import { type AuthSession } from '../utils/auth';
import { formatDate, formatPrice, orderNo } from '../components/OrderCard';

type ApiOrder = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress: unknown;
  totalPrice: number;
  createdAt: string;
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

const COMPLETED_STATUSES = new Set(['completed', 'delivered']);
const HIDDEN_STATUSES = new Set(['cancelled', 'rejected']);

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isCompletedOrder(status: string): boolean {
  return COMPLETED_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

function isHiddenOrder(status: string): boolean {
  return HIDDEN_STATUSES.has(String(status ?? '').trim().toLowerCase());
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

    const result = await apiRequest<ApiOrder[]>(
      '/v1/orders?pageSize=100&sortDir=desc',
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );

    if (result.ok) {
      const mapped = (result.data as unknown as ApiOrder[]).map((order: ApiOrder) => ({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        sellerName: order.sellerName ?? t('status.orders.sellerFallback'),
        items: order.items.map((item) => ({ name: item.name, quantity: item.quantity })),
        totalPrice: Number(order.totalPrice ?? 0),
        createdAt: order.createdAt,
        deliveryType: order.deliveryType,
      }));
      setOrders(mapped);
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

  const visibleOrders = orders.filter((order) => !isHiddenOrder(order.status));
  const activeOrder = visibleOrders.find((order) => !isCompletedOrder(order.status)) ?? null;
  const filteredActiveOrder = activeOrder && matchesQuery(activeOrder, searchQuery) ? activeOrder : null;
  const filteredCompletedOrders = visibleOrders.filter(
    (order) => isCompletedOrder(order.status) && matchesQuery(order, searchQuery),
  );
  const hasSearch = searchQuery.trim().length > 0;
  const hasVisibleHistory = visibleOrders.some((order) => isCompletedOrder(order.status));
  const showSearchEmpty = hasSearch && !filteredActiveOrder && filteredCompletedOrders.length === 0;

  function renderHeroCard(order: BuyerOrderSummary) {
    return (
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() => onOpenOrderDetail(order.id)}
        style={styles.heroCard}
      >
        <View style={styles.heroTopRow}>
          <View style={styles.heroPill}>
            <View style={styles.heroPillDot} />
            <Text style={styles.heroPillText}>{t('status.orders.activePill')}</Text>
          </View>
          <Text style={styles.metaText}>{formatDate(order.createdAt)}</Text>
        </View>

        <View style={styles.heroTitleRow}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroSeller} numberOfLines={1}>{order.sellerName}</Text>
            <Text style={styles.heroOrderNo}>{getDisplayOrderNo(order)}</Text>
          </View>
          <StatusBadge status={order.status} deliveryType={order.deliveryType} audience="buyer" />
        </View>

          <Text style={styles.heroItems} numberOfLines={2}>
          {getItemsLine(order) || t('helper.orders.itemsFallback')}
        </Text>

        <View style={styles.heroBottomRow}>
          <View>
            <Text style={styles.metaLabel}>
              {order.deliveryType === 'delivery'
                ? t('status.orders.deliveryType.delivery')
                : t('status.orders.deliveryType.pickup')}
            </Text>
            <Text style={styles.heroPrice}>{formatPrice(order.totalPrice)}</Text>
          </View>
          <View style={styles.heroAction}>
            <Text style={styles.heroActionText}>{t('cta.orders.openDetail')}</Text>
            <Ionicons name="arrow-forward" size={16} color={theme.onPrimary} />
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderCompletedCard({ item }: { item: BuyerOrderSummary }) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => onOpenOrderDetail(item.id)}
        style={styles.orderCard}
      >
        <View style={styles.orderCardHeader}>
          <View style={styles.orderCardTitleBlock}>
            <Text style={styles.orderCardSeller} numberOfLines={1}>{item.sellerName}</Text>
            <Text style={styles.orderCardOrderNo}>{getDisplayOrderNo(item)}</Text>
          </View>
          <StatusBadge status={item.status} deliveryType={item.deliveryType} audience="buyer" />
        </View>

        <Text style={styles.orderCardItems} numberOfLines={2}>
          {getItemsLine(item) || t('helper.orders.itemsFallback')}
        </Text>

        <View style={styles.orderMetaRow}>
          <View style={styles.orderMetaChip}>
            <Ionicons name="calendar-outline" size={14} color="#7F7569" />
            <Text style={styles.orderMetaChipText}>{formatDate(item.createdAt)}</Text>
          </View>
          <View style={styles.orderMetaChip}>
            <Ionicons
              name={item.deliveryType === 'delivery' ? 'bicycle-outline' : 'bag-handle-outline'}
              size={14}
              color="#7F7569"
            />
            <Text style={styles.orderMetaChipText}>
              {item.deliveryType === 'delivery'
                ? t('status.orders.deliveryType.delivery')
                : t('status.orders.deliveryType.pickup')}
            </Text>
          </View>
        </View>

        <View style={styles.orderCardFooter}>
          <Text style={styles.orderCardPrice}>{formatPrice(item.totalPrice)}</Text>
          <View style={styles.orderCardAction}>
            <Text style={styles.orderCardActionText}>{t('cta.orders.openDetail')}</Text>
            <Ionicons name="chevron-forward" size={16} color="#5D7394" />
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
      ) : visibleOrders.length === 0 ? (
        <EmptyState icon="receipt-outline" title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        <FlatList
          data={filteredCompletedOrders}
          keyExtractor={(item) => item.id}
          renderItem={renderCompletedCard}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.headerContent}>
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

              {filteredActiveOrder ? (
                <View style={styles.sectionBlock}>
                  <View style={styles.sectionHeading}>
                    <View>
                      <Text style={styles.sectionTitle}>{t('headline.orders.activeTitle')}</Text>
                      <Text style={styles.sectionSubtitle}>{t('helper.orders.activeSubtitle')}</Text>
                    </View>
                  </View>
                  {renderHeroCard(filteredActiveOrder)}
                </View>
              ) : null}

              <View style={[styles.sectionHeading, filteredActiveOrder ? styles.sectionHeadingSpaced : null]}>
                <View>
                  <Text style={styles.sectionTitle}>{t('headline.orders.completedTitle')}</Text>
                  <Text style={styles.sectionSubtitle}>{t('helper.orders.completedSubtitle')}</Text>
                </View>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>
                    {filteredCompletedOrders.length} {t('status.orders.countSuffix')}
                  </Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            showSearchEmpty ? (
              <EmptyState
                icon="search-outline"
                title={t('helper.orders.searchEmptyTitle')}
                subtitle={t('helper.orders.searchEmptySubtitle')}
              />
            ) : filteredActiveOrder ? null : (
              <EmptyState
                icon="receipt-outline"
                title={t('helper.orders.completedEmptyTitle')}
                subtitle={t('helper.orders.completedEmptySubtitle')}
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  headerContent: { paddingTop: 12, paddingBottom: 18 },
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
  sectionBlock: { marginTop: 22 },
  sectionHeading: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sectionHeadingSpaced: { marginTop: 28 },
  sectionTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sectionSubtitle: {
    marginTop: 4,
    color: '#7B6F62',
    fontSize: 13,
    lineHeight: 18,
  },
  countPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ECE4D9',
  },
  countPillText: {
    color: '#6D6257',
    fontSize: 12,
    fontWeight: '700',
  },
  heroCard: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#E6DED3',
    backgroundColor: '#FFFDF9',
    padding: 18,
    shadowColor: '#3D3229',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(74,124,89,0.12)',
  },
  heroPillDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: theme.primary,
  },
  heroPillText: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  metaText: {
    color: '#8C7F71',
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  heroTitleBlock: { flex: 1 },
  heroSeller: {
    color: '#2F241B',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  heroOrderNo: {
    marginTop: 4,
    color: '#8B7D6F',
    fontSize: 13,
    fontWeight: '700',
  },
  heroItems: {
    marginTop: 16,
    color: '#65594E',
    fontSize: 14,
    lineHeight: 21,
  },
  heroBottomRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#EFE7DB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 16,
  },
  metaLabel: {
    color: '#8A7E71',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  heroPrice: {
    marginTop: 4,
    color: theme.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  heroAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.buttonActive,
  },
  heroActionText: {
    color: theme.onPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  separator: { height: 12 },
  orderCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7DED3',
    backgroundColor: theme.card,
    padding: 16,
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  orderCardTitleBlock: { flex: 1 },
  orderCardSeller: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  orderCardOrderNo: {
    marginTop: 4,
    color: '#8E8174',
    fontSize: 12,
    fontWeight: '600',
  },
  orderCardItems: {
    marginTop: 12,
    color: '#6B5F53',
    fontSize: 14,
    lineHeight: 20,
  },
  orderMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  orderMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F5EFE7',
  },
  orderMetaChipText: {
    color: '#74685C',
    fontSize: 12,
    fontWeight: '600',
  },
  orderCardFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#EFE7DB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderCardPrice: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  orderCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderCardActionText: {
    color: '#5D7394',
    fontSize: 13,
    fontWeight: '700',
  },
});
