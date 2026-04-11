import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import { formatCopy, t } from '../copy/brandCopy';

type ProofRecord = {
  orderId: string;
  proofMode: string;
  pinSentAt: string | null;
  pinVerifiedAt: string | null;
  verificationAttempts: number;
  status: 'pending' | 'verified' | 'failed' | 'expired';
  pin?: string | null;
};

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onVerified?: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function DeliveryPinScreen({ auth, orderId, onBack, onVerified, onAuthRefresh }: Props) {
  const [record, setRecord] = useState<ProofRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const verifiedHandledRef = useRef(false);

  const fetchProof = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    const result = await apiRequest<ProofRecord>(
      `/v1/orders/${orderId}/delivery-proof`,
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setRecord(result.data);
      if (!silent) setError(null);
    } else if (result.status === 404 || result.status === 403) {
      setRecord(null);
      if (!silent) setError(null);
    } else if (!silent) {
      setError(result.message ?? t('status.deliveryPin.loading'));
    }
    if (!silent) setLoading(false);
  }, [orderId, auth.accessToken, auth.userId, onAuthRefresh]);

  useEffect(() => { void fetchProof(); }, [fetchProof]);

  useEffect(() => {
    const shouldPoll = !record || record.status === 'pending';
    if (!shouldPoll) return () => {};
    const interval = setInterval(() => { void fetchProof({ silent: true }); }, 3_000);
    return () => clearInterval(interval);
  }, [record?.status, record?.pin, fetchProof]);

  useEffect(() => {
    if (!record) return;
    if (record.status !== 'verified') return;
    if (verifiedHandledRef.current) return;
    verifiedHandledRef.current = true;
    onVerified?.();
  }, [record?.status, onVerified]);

  const statusConfig = {
    pending: { icon: 'time-outline' as const, color: '#D4740B', bg: '#FFF4E5', label: t('headline.deliveryPin.pending'), sub: t('helper.deliveryPin.pending') },
    verified: { icon: 'checkmark-circle' as const, color: '#3E845B', bg: '#E4F2E7', label: t('headline.deliveryPin.verified'), sub: t('helper.deliveryPin.verified') },
    failed: { icon: 'close-circle' as const, color: '#C0392B', bg: '#FDECEC', label: t('headline.deliveryPin.failed'), sub: t('helper.deliveryPin.failed') },
    expired: { icon: 'timer-outline' as const, color: '#C0392B', bg: '#FDECEC', label: t('headline.deliveryPin.expired'), sub: t('helper.deliveryPin.expired') },
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.deliveryPin.title')} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('status.deliveryPin.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchProof} />
      ) : !record ? (
        <View style={styles.center}>
          <Ionicons name="lock-open-outline" size={48} color={theme.textSecondary} />
          <Text style={styles.emptyTitle}>{t('headline.deliveryPin.emptyTitle')}</Text>
          <Text style={styles.emptySub}>{t('helper.deliveryPin.emptySubtitle')}</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <View style={[styles.statusCircle, { backgroundColor: statusConfig[record.status].bg }]}>
            <Ionicons
              name={statusConfig[record.status].icon}
              size={56}
              color={statusConfig[record.status].color}
            />
          </View>
          <Text style={styles.statusLabel}>{statusConfig[record.status].label}</Text>
          <Text style={styles.statusSub}>{statusConfig[record.status].sub}</Text>

          {record.status === 'pending' && (
            <View style={styles.pinInfo}>
              <Text style={styles.pinLabel}>{t('helper.deliveryPin.codeLabel')}</Text>
              <Text style={styles.pinCode}>{record.pin ?? '-'}</Text>
              <Text style={styles.pinHint}>{t('helper.deliveryPin.codeHint')}</Text>
              <Text style={styles.pinAttempts}>
                {formatCopy('helper.deliveryPin.attemptsRemaining', {
                  remaining: Math.max(0, 5 - record.verificationAttempts),
                })}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 16 },
  emptySub: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 22 },
  statusCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusLabel: { color: theme.text, fontSize: 22, fontWeight: '800' },
  statusSub: { color: '#71685F', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 8 },
  pinInfo: {
    marginTop: 24,
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
    alignItems: 'center',
    width: '100%',
  },
  pinLabel: { color: '#71685F', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  pinCode: { color: theme.text, fontSize: 34, fontWeight: '900', letterSpacing: 4, marginTop: 8 },
  pinHint: { color: '#71685F', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  pinAttempts: { color: theme.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
});
