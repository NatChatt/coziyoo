import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import { formatCopy, t } from '../copy/brandCopy';
import { getCurrentLanguage } from '../utils/settings';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';

type TicketSummary = {
  id: string;
  ticketNo: number;
  orderId?: string | null;
  primaryFoodName?: string | null;
  deliveryType?: 'pickup' | 'delivery' | string | null;
  category?: string | null;
  categoryName?: string | null;
  status: 'open' | 'in_review' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  lastActivityAt: string;
};

type TicketListResponse = {
  items?: TicketSummary[];
};

type Props = {
  auth: AuthSession;
  actorRole: 'buyer' | 'seller';
  onBack: () => void;
  onOpenTicket: (ticketId: string) => void;
  onCreateTicket: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function statusLabel(status: TicketSummary['status']) {
  if (status === 'open') return t('status.ticket.state.open');
  if (status === 'in_review') return t('status.ticket.state.in_review');
  if (status === 'resolved') return t('status.ticket.state.resolved');
  return t('status.ticket.state.closed');
}

function statusColor(status: TicketSummary['status']) {
  if (status === 'open') return '#D87A16';
  if (status === 'in_review') return '#2F6CA6';
  if (status === 'resolved') return '#3E845B';
  return '#6C6258';
}

function deliveryTypeLabel(value?: string | null) {
  return String(value || '').trim().toLowerCase() === 'delivery'
    ? t('status.orders.deliveryType.delivery')
    : t('status.orders.deliveryType.pickup');
}

function normalizeTickets(data: TicketListResponse | TicketSummary[]): TicketSummary[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export default function TicketListScreen({ auth, actorRole, onBack, onOpenTicket, onCreateTicket, onAuthRefresh }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);

  async function loadData(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const result = await apiRequest<TicketListResponse | TicketSummary[]>(
      '/v1/tickets/',
      auth,
      { method: 'GET', actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setTickets(normalizeTickets(result.data));
    } else {
      setError(result.message ?? t('error.ticket.load'));
    }
    if (showRefresh) setRefreshing(false);
    else setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.ticket.list')} onBack={onBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
      >
        {actorRole === 'buyer' ? (
          <View style={styles.topCta}>
            <ActionButton label={t('cta.ticket.create')} onPress={onCreateTicket} variant="primary" fullWidth />
          </View>
        ) : null}

        {loading ? <Text style={styles.meta}>{t('status.ticket.loading')}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !error && tickets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color="#8A7D70" />
            <Text style={styles.emptyTitle}>{t('headline.ticket.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('helper.ticket.emptySubtitle')}</Text>
          </View>
        ) : null}

        {tickets.map((item) => (
          <TouchableOpacity key={item.id} style={styles.ticketCard} activeOpacity={0.75} onPress={() => onOpenTicket(item.id)}>
            <View style={styles.ticketHead}>
              <View style={styles.ticketHeadLeft}>
                <Text style={styles.ticketFood} numberOfLines={1}>
                  {item.primaryFoodName ?? t('helper.orders.itemsFallback')}
                  {item.orderId ? ` • ${deliveryTypeLabel(item.deliveryType)}` : ''}
                </Text>
                <Text style={styles.ticketNo}>#{item.ticketNo}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${statusColor(item.status)}1A` }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
              </View>
            </View>
            <Text style={styles.ticketCategory}>{item.categoryName ?? t('status.ticket.categoryFallback')}</Text>
            {item.orderId ? (
              <Text style={styles.ticketMeta}>
                {formatCopy('status.ticket.orderLabel', { id: item.orderId.slice(0, 8).toUpperCase() })}
              </Text>
            ) : null}
            <Text style={styles.ticketMeta}>
              {formatCopy('status.ticket.lastActivity', {
                date: new Date(item.lastActivityAt).toLocaleString(getCurrentLanguage() === 'en' ? 'en-GB' : 'tr-TR'),
              })}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 20, gap: 12 },
  topCta: { marginBottom: 4 },
  meta: { color: '#7A6E61', fontSize: 14 },
  error: { color: '#B2432D', fontWeight: '600' },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    backgroundColor: '#FCFBF9',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: theme.text },
  emptySub: { fontSize: 13, color: '#7D7062', textAlign: 'center' },
  ticketCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 6,
  },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketHeadLeft: { flex: 1, marginRight: 8 },
  ticketNo: { color: theme.text, fontSize: 16, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  ticketCategory: { color: theme.text, fontSize: 15, fontWeight: '700' },
  ticketFood: { color: '#4D4339', fontSize: 14, fontWeight: '700' },
  ticketMeta: { color: '#7A6E61', fontSize: 13, fontWeight: '500' },
});
