import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { t, type BrandCopyKey } from '../copy/brandCopy';

const STATUS_MAP: Record<string, { labelKey: BrandCopyKey; color: string; bg: string }> = {
  pending_seller_approval: { labelKey: 'status.common.badge.pendingSellerApproval', color: '#B86A00', bg: '#FFF3E0' },
  seller_approved: { labelKey: 'status.common.badge.sellerApproved', color: '#A16207', bg: '#FFF8EB' },
  confirmed: { labelKey: 'status.common.badge.confirmed', color: '#9A3412', bg: '#FFF1EB' },
  awaiting_payment: { labelKey: 'status.common.badge.awaitingPayment', color: '#7C5D00', bg: '#FFF7D6' },
  paid: { labelKey: 'status.common.badge.paid', color: '#0F766E', bg: '#E6FFFB' },
  preparing: { labelKey: 'status.common.badge.preparing', color: '#B45309', bg: '#FFF4E8' },
  ready: { labelKey: 'status.common.badge.ready', color: '#15803D', bg: '#EAF7EE' },
  pickup_ready: { labelKey: 'status.common.badge.pickupReady', color: '#15803D', bg: '#EAF7EE' },
  pickup_ready_seller: { labelKey: 'status.common.badge.pickupReadySeller', color: '#15803D', bg: '#EAF7EE' },
  in_delivery: { labelKey: 'status.common.badge.inDelivery', color: '#1D4ED8', bg: '#E7F0FF' },
  approaching: { labelKey: 'status.common.badge.approaching', color: '#0E7490', bg: '#E6F7FB' },
  at_door: { labelKey: 'status.common.badge.atDoor', color: '#C2410C', bg: '#FFF1EB' },
  delivered: { labelKey: 'status.common.badge.delivered', color: '#047857', bg: '#E8FBF4' },
  completed: { labelKey: 'status.common.badge.delivered', color: '#166534', bg: '#EAF7EE' },
  rejected: { labelKey: 'status.common.badge.rejected', color: '#B91C1C', bg: '#FEECEC' },
  cancelled: { labelKey: 'status.common.badge.cancelled', color: '#7F1D1D', bg: '#FDECEC' },
};

type Props = {
  status: string;
  size?: 'sm' | 'md';
  deliveryType?: 'pickup' | 'delivery' | string;
  audience?: 'buyer' | 'seller';
};

function statusKeyByDeliveryType(status: string, deliveryType?: string): string {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const normalizedDeliveryType = String(deliveryType ?? '').trim().toLowerCase();
  if (normalizedDeliveryType === 'pickup' && normalizedStatus === 'ready') {
    return 'pickup_ready';
  }
  return normalizedStatus;
}

function resolveLabel(statusKey: string, fallbackLabel: string, audience?: 'buyer' | 'seller'): string {
  if (audience === 'buyer' && statusKey === 'paid') return t('status.common.badge.paid');
  return fallbackLabel;
}

export default function StatusBadge({ status, size = 'sm', deliveryType, audience }: Props) {
  const key = statusKeyByDeliveryType(status, deliveryType);
  const info = STATUS_MAP[key] ?? null;
  const fallbackLabel = info ? t(info.labelKey) : status;
  const label = resolveLabel(key, fallbackLabel, audience);
  const isMd = size === 'md';

  return (
    <View style={[styles.badge, { backgroundColor: info?.bg ?? '#F0EBE4' }, isMd && styles.badgeMd]}>
      <Text style={[styles.text, { color: info?.color ?? '#71685F' }, isMd && styles.textMd]}>
        {label}
      </Text>
    </View>
  );
}

export function getStatusInfo(status: string, deliveryType?: string) {
  const key = statusKeyByDeliveryType(status, deliveryType);
  const info = STATUS_MAP[key];
  if (!info) {
    return { label: status, color: '#71685F', bg: '#F0EBE4' };
  }
  return { label: t(info.labelKey), color: info.color, bg: info.bg };
}

const styles = StyleSheet.create({
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeMd: { paddingHorizontal: 14, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '700' },
  textMd: { fontSize: 14 },
});
