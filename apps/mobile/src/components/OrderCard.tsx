import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StatusBadge from './StatusBadge';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';
import { getCurrentLanguage } from '../utils/settings';

export type OrderSummary = {
  id: string;
  status: string;
  sellerName: string;
  items: { name: string; quantity: number }[];
  totalPrice: number;
  createdAt: string;
  deliveryType: 'pickup' | 'delivery';
};

type Props = {
  order: OrderSummary;
  onPress: () => void;
};

function formatPrice(price: number): string {
  return '₺' + price.toFixed(2).replace('.', ',');
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  // Normalize PostgreSQL timestamp: "2024-01-15 22:26:00.123+00" → valid ISO 8601
  const normalized = iso
    .trim()
    .replace(' ', 'T')                   // space → T
    .replace(/(\.\d+)?([+-]\d{2})$/, '$1$2:00');  // +00 → +00:00
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat(getCurrentLanguage() === 'en' ? 'en-GB' : 'tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export default function OrderCard({ order, onPress }: Props) {
  const itemNames = order.items.map(i => i.name).join(', ');

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.header}>
        <StatusBadge status={order.status} deliveryType={order.deliveryType} audience="buyer" />
        <Text style={styles.date}>{formatDate(order.createdAt)}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.shopRow}>
          <Text style={styles.shop} numberOfLines={1}>{order.sellerName}</Text>
        </View>
        <Text style={styles.items} numberOfLines={1}>{itemNames || t('helper.orders.itemsFallback')}</Text>
      </View>
      <View style={styles.footer}>
        <Text style={styles.total}>{formatPrice(order.totalPrice)}</Text>
        <View style={styles.detailBtn}>
          <Text style={styles.detailText}>{t('cta.orders.openDetail')}</Text>
          <Ionicons name="chevron-forward" size={14} color="#5D7394" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function orderNo(id: string): string {
  return '#' + id.slice(0, 8).toUpperCase();
}

export { formatPrice, formatDate, orderNo };

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    backgroundColor: '#FCFBF9',
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  date: { color: '#9B8E80', fontSize: 12, fontWeight: '500' },
  body: { marginBottom: 10 },
  shopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shop: { color: theme.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  orderNo: { color: '#9B8E80', fontSize: 12, fontWeight: '500' },
  items: { color: '#71685F', fontSize: 13, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDE8E1',
    paddingTop: 10,
  },
  total: { color: theme.text, fontSize: 16, fontWeight: '800' },
  detailBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailText: { color: '#5D7394', fontSize: 13, fontWeight: '600' },
});
