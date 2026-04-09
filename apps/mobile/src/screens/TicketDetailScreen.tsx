import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TextInput, Alert } from 'react-native';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';

type TicketMessage = {
  id: string;
  senderRole: 'buyer' | 'admin';
  senderName: string;
  senderUserId: string;
  message: string;
  createdAt: string;
};

type TicketDetail = {
  id: string;
  ticketNo: number;
  orderId?: string | null;
  status: 'open' | 'in_review' | 'resolved' | 'closed';
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
  ticketId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function statusLabel(status: TicketDetail['status']) {
  if (status === 'open') return 'Açık';
  if (status === 'in_review') return 'İnceleniyor';
  if (status === 'resolved') return 'Çözüldü';
  return 'Kapandı';
}

function normalizeTicketDetail(data: TicketDetail): TicketDetail {
  return {
    ...data,
    lastActivityAt: data.lastActivityAt ?? data.createdAt,
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

export default function TicketDetailScreen({ auth, ticketId, onBack, onAuthRefresh }: Props) {
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
      { method: 'GET', actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setTicket(normalizeTicketDetail(result.data));
    } else {
      setError(result.message ?? 'Ticket detayı yüklenemedi.');
    }
    if (showRefresh) setRefreshing(false);
    else setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [ticketId]);

  async function handleSendMessage() {
    if (message.trim().length < 2) {
      Alert.alert('Mesaj kısa', 'En az 2 karakter yazmalısın.');
      return;
    }
    setSending(true);
    const result = await apiRequest(
      `/v1/tickets/${ticketId}/messages`,
      auth,
      { method: 'POST', actorRole: 'buyer', body: { message: message.trim() } },
      onAuthRefresh,
    );
    setSending(false);
    if (!result.ok) {
      Alert.alert('Hata', result.message ?? 'Mesaj gönderilemedi.');
      return;
    }
    setMessage('');
    await loadData(true);
  }

  const closed = ticket?.status === 'resolved' || ticket?.status === 'closed';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={ticket ? `Ticket #${ticket.ticketNo}` : 'Ticket'} onBack={onBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
      >
        {loading ? <Text style={styles.meta}>Yükleniyor...</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {ticket ? (
          <>
            <View style={styles.card}>
              <Text style={styles.title}>{ticket.categoryName ?? 'Destek Talebi'}</Text>
              <Text style={styles.meta}>Durum: {statusLabel(ticket.status)}</Text>
              <Text style={styles.meta}>Öncelik: {ticket.priority}</Text>
              {ticket.orderId ? <Text style={styles.meta}>Sipariş: #{ticket.orderId.slice(0, 8).toUpperCase()}</Text> : null}
              {ticket.lastActivityAt ? <Text style={styles.meta}>Son hareket: {new Date(ticket.lastActivityAt).toLocaleString('tr-TR')}</Text> : null}
              {ticket.description ? <Text style={styles.description}>{ticket.description}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Mesajlar</Text>
              {ticket.messages?.length === 0 ? (
                <Text style={styles.meta}>Henüz mesaj yok.</Text>
              ) : (
                ticket.messages?.map((item) => (
                  <View key={item.id} style={[styles.messageBubble, item.senderRole === 'buyer' ? styles.messageMine : styles.messageSupport]}>
                    <Text style={styles.messageAuthor}>{item.senderRole === 'buyer' ? 'Sen' : item.senderName || 'Destek'}</Text>
                    <Text style={styles.messageText}>{item.message}</Text>
                    <Text style={styles.messageTime}>{new Date(item.createdAt).toLocaleString('tr-TR')}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Destek Mesajı</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={closed ? 'Bu ticket kapandığı için mesaj kapalı.' : 'Kısa bir güncelleme yaz...'}
                editable={!closed}
                multiline
                style={[styles.input, closed && styles.inputDisabled]}
              />
              <ActionButton
                label="Mesajı Gönder"
                onPress={() => void handleSendMessage()}
                disabled={closed || message.trim().length < 2}
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
});
