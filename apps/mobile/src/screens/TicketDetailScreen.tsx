import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';
import { formatCopy, t } from '../copy/brandCopy';
import { getCurrentLanguage } from '../utils/settings';

type TicketMessage = {
  id: string;
  authorType: 'user' | 'admin';
  authorUserId?: string | null;
  authorAdminId?: string | null;
  recipientUserId?: string | null;
  recipientRole?: string | null;
  senderName?: string | null;
  body: string;
  createdAt?: string | null;
};

type TicketDetail = {
  id: string;
  ticketNo: number;
  orderId?: string | null;
  status: 'open' | 'in_review' | 'awaiting_response' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category?: string | null;
  categoryName?: string | null;
  description?: string | null;
  createdAt: string;
  lastActivityAt?: string | null;
  messages?: TicketMessage[];
};

type Props = {
  auth: AuthSession;
  actorRole: 'buyer' | 'seller';
  ticketId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function statusLabel(status: TicketDetail['status']) {
  if (status === 'open') return t('status.ticket.state.open');
  if (status === 'in_review') return t('status.ticket.state.in_review');
  if (status === 'awaiting_response') return t('status.ticket.state.awaiting_response');
  if (status === 'resolved') return t('status.ticket.state.resolved');
  return t('status.ticket.state.closed');
}

function priorityLabel(priority: TicketDetail['priority']) {
  if (priority === 'low') return t('status.ticket.priority.low');
  if (priority === 'high') return t('status.ticket.priority.high');
  if (priority === 'urgent') return t('status.ticket.priority.urgent');
  return t('status.ticket.priority.medium');
}

function normalizeTicketDetail(data: TicketDetail): TicketDetail {
  return {
    ...data,
    lastActivityAt: data.lastActivityAt ?? data.createdAt,
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

export default function TicketDetailScreen({ auth, actorRole, ticketId, onBack, onAuthRefresh }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [message, setMessage] = useState('');

  async function loadData(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const result = await apiRequest<TicketDetail>(
      `/v1/tickets/${ticketId}`,
      auth,
      { method: 'GET', actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setTicket(normalizeTicketDetail(result.data));
    } else {
      setError(result.message ?? t('error.ticket.detailLoad'));
    }
    if (showRefresh) setRefreshing(false);
    else setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [ticketId]);

  async function handleSendMessage() {
    if (!ticket) return;
    if (message.trim().length < 2) {
      Alert.alert(t('error.ticket.messageTooShortTitle'), t('error.ticket.messageTooShortBody'));
      return;
    }
    setSending(true);
    const result = await apiRequest(
      `/v1/tickets/${ticketId}/messages`,
      auth,
      { method: 'POST', actorRole, body: { message: message.trim() } },
      onAuthRefresh,
    );
    setSending(false);
    if (!result.ok) {
      Alert.alert(t('headline.common.error'), result.message ?? t('error.ticket.messageSend'));
      return;
    }
    setMessage('');
    await loadData(true);
  }

  const closed = ticket?.status === 'resolved' || ticket?.status === 'closed';
  const hasAdminReply = Boolean(ticket?.messages?.some((item) => item.authorType === 'admin'));
  const messagingEnabled = Boolean(ticket && hasAdminReply && !closed);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={ticket ? `#${ticket.ticketNo}` : t('headline.ticket.detailFallback')} onBack={onBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
      >
        {loading ? <Text style={styles.meta}>{t('status.ticket.loading')}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {ticket ? (
          <>
            <View style={styles.card}>
              <Text style={styles.title}>{ticket.categoryName ?? t('headline.ticket.detailFallback')}</Text>
              <Text style={styles.meta}>{formatCopy('label.ticket.status', { value: statusLabel(ticket.status) })}</Text>
              <Text style={styles.meta}>{formatCopy('label.ticket.priority', { value: priorityLabel(ticket.priority) })}</Text>
              {ticket.orderId ? <Text style={styles.meta}>{formatCopy('status.ticket.orderLabel', { id: ticket.orderId.slice(0, 8).toUpperCase() })}</Text> : null}
              {ticket.lastActivityAt ? <Text style={styles.meta}>{formatCopy('status.ticket.lastActivity', { date: new Date(ticket.lastActivityAt).toLocaleString(getCurrentLanguage() === 'en' ? 'en-GB' : 'tr-TR') })}</Text> : null}
              {ticket.description ? <Text style={styles.description}>{ticket.description}</Text> : null}
            </View>

            {actorRole === 'buyer' && !messagingEnabled && !closed && (
              <View style={styles.infoCard}>
                <Ionicons name="time-outline" size={20} color="#7A6E61" />
                <Text style={styles.infoText}>{t('helper.ticket.underReview')}</Text>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t('label.ticket.messages')}</Text>
              {ticket.messages?.length === 0 ? (
                <Text style={styles.meta}>{t('helper.ticket.noMessages')}</Text>
              ) : (
                ticket.messages?.map((item) => (
                  <View key={item.id} style={[styles.messageBubble, item.authorType === 'admin' ? styles.messageSupport : styles.messageMine]}>
                    <Text style={styles.messageAuthor}>
                      {item.authorType === 'admin'
                        ? (item.senderName || t('status.ticket.authorSupport'))
                        : t('status.ticket.authorBuyer')}
                    </Text>
                    <Text style={styles.messageText}>{item.body}</Text>
                    {item.createdAt ? (
                      <Text style={styles.messageTime}>
                        {new Date(item.createdAt).toLocaleString(getCurrentLanguage() === 'en' ? 'en-GB' : 'tr-TR')}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t('label.ticket.supportMessage')}</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={
                  closed
                    ? t('helper.ticket.closedMessagePlaceholder')
                    : hasAdminReply
                      ? t('helper.ticket.messagePlaceholder')
                      : t('helper.ticket.underReview')
                }
                editable={messagingEnabled}
                multiline
                style={[styles.input, !messagingEnabled && styles.inputDisabled]}
              />
              <ActionButton
                label={t('cta.ticket.sendMessage')}
                onPress={() => void handleSendMessage()}
                disabled={!messagingEnabled || message.trim().length < 2}
                loading={sending}
                fullWidth
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 12 },
  title: { color: theme.text, fontSize: 17, fontWeight: '800' },
  meta: { color: '#7A6E61', fontSize: 13, fontWeight: '500' },
  error: { color: '#B2432D', fontWeight: '600' },
  description: { marginTop: 8, color: '#4D4339', fontSize: 14, lineHeight: 20 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 8,
  },
  sectionTitle: { color: theme.text, fontSize: 15, fontWeight: '800' },
  messageBubble: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  messageMine: { borderColor: '#CEE2D4', backgroundColor: '#EDF7F0' },
  messageSupport: { borderColor: '#E6DDD3', backgroundColor: '#FCFBF9' },
  messageAuthor: { color: theme.text, fontSize: 12, fontWeight: '800' },
  messageText: { color: '#3E352C', fontSize: 14, lineHeight: 20 },
  messageTime: { color: '#7A6E61', fontSize: 11, fontWeight: '500' },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    backgroundColor: '#FCFBF9',
    textAlignVertical: 'top',
  },
  inputDisabled: { opacity: 0.6 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F5F0EB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    padding: 14,
  },
  infoText: { flex: 1, color: '#7A6E61', fontSize: 13, lineHeight: 20 },
});
