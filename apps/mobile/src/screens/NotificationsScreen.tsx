import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { formatCopy, t } from '../copy/brandCopy';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  dataJson: unknown;
};

const TYPE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  delivery_pin: { icon: 'key-outline', color: '#6B4FA2', bg: '#EDE8F5' },
  order_update: { icon: 'receipt-outline', color: '#5D7394', bg: '#E8EDF3' },
  order_received: { icon: 'receipt-outline', color: '#5D7394', bg: '#E8EDF3' },
  order_preparing: { icon: 'restaurant-outline', color: '#B7791F', bg: '#FEF3C7' },
  order_in_delivery: { icon: 'bicycle-outline', color: '#2563EB', bg: '#DBEAFE' },
  order_halfway: { icon: 'navigate-outline', color: '#2563EB', bg: '#E8EDF3' },
  eta_10m: { icon: 'time-outline', color: '#2563EB', bg: '#E8EDF3' },
  eta_5m: { icon: 'timer-outline', color: '#1D4ED8', bg: '#E0EAFF' },
  eta_2m: { icon: 'flash-outline', color: '#1E40AF', bg: '#DBEAFE' },
  at_door: { icon: 'home-outline', color: '#15803D', bg: '#DCFCE7' },
  payment: { icon: 'card-outline', color: '#3E845B', bg: '#E4F2E7' },
  complaint: { icon: 'flag-outline', color: '#C0392B', bg: '#FDECEC' },
  review: { icon: 'star-outline', color: '#C4953A', bg: '#FFF4E5' },
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrderDetail?: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function NotificationsScreen({ auth, onBack, onOpenOrderDetail, onAuthRefresh }: Props) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    const result = await apiRequest<NotificationItem[]>(
      '/v1/notifications',
      auth,
      undefined,
      onAuthRefresh,
    );
    if (result.ok) {
      setNotifications(Array.isArray(result.data) ? result.data : []);
    } else {
      if (result.status !== 404) {
        setError(result.message ?? t('error.notifications.load'));
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [auth.accessToken, auth.userId, onAuthRefresh]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('status.notifications.justNow');
    if (diffMin < 60) return formatCopy('status.notifications.minutesAgo', { count: diffMin });
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return formatCopy('status.notifications.hoursAgo', { count: diffHour });
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return formatCopy('status.notifications.daysAgo', { count: diffDay });
    return `${d.getDate()} ${t(`status.notifications.month.${d.getMonth()}` as any)}`;
  }

  function extractOrderId(dataJson: unknown): string | null {
    if (!dataJson || typeof dataJson !== 'object') return null;
    const value = (dataJson as Record<string, unknown>).orderId;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  async function handleNotificationPress(item: NotificationItem) {
    if (!item.isRead) {
      await apiRequest(
        `/v1/notifications/${item.id}/read`,
        auth,
        { method: 'PATCH' },
        onAuthRefresh,
      );
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    }

    const orderId = extractOrderId(item.dataJson);
    if (orderId && onOpenOrderDetail) {
      onOpenOrderDetail(orderId);
    }
  }

  function renderItem({ item }: { item: NotificationItem }) {
    const typeInfo = TYPE_ICONS[item.type] ?? { icon: 'notifications-outline' as const, color: '#71685F', bg: '#F0ECE6' };

    return (
      <TouchableOpacity
        style={[styles.notifCard, !item.isRead && styles.notifUnread]}
        activeOpacity={0.7}
        onPress={() => { void handleNotificationPress(item); }}
      >
        <View style={[styles.notifIcon, { backgroundColor: typeInfo.bg }]}>
          <Ionicons name={typeInfo.icon} size={20} color={typeInfo.color} />
        </View>
        <View style={styles.notifBody}>
          <Text style={styles.notifTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.notifText} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
        </View>
        {!item.isRead && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.notifications.title')} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('status.notifications.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchNotifications()} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title={t('headline.notifications.emptyTitle')}
          subtitle={t('helper.notifications.emptySubtitle')}
        />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotifications(true); }} tintColor={theme.primary} />
          }
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  list: { padding: 16, paddingBottom: 40 },
  sep: { height: 10 },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 14,
    gap: 12,
  },
  notifUnread: { backgroundColor: '#F8F5EE', borderColor: '#D5CFC7' },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBody: { flex: 1 },
  notifTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  notifText: { color: '#71685F', fontSize: 13, marginTop: 2, lineHeight: 19 },
  notifTime: { color: '#9B8E80', fontSize: 11, marginTop: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.primary,
    marginTop: 4,
  },
});
