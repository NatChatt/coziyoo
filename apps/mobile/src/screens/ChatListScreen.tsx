import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, StatusBar, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { t } from '../copy/brandCopy';

type ChatSummary = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerImage: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  buyerUnreadCount: number;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenChat: (chatId: string, sellerName: string) => void;
  actorRole?: 'buyer' | 'seller';
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ChatListScreen({ auth, onBack, onOpenChat, actorRole = 'buyer', onAuthRefresh }: Props) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChats = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    const result = await apiRequest<ChatSummary[]>(
      '/v1/chats',
      auth,
      { actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setChats(Array.isArray(result.data) ? result.data : []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [actorRole, auth.accessToken, auth.userId, onAuthRefresh]);

  useEffect(() => { fetchChats(); }, [fetchChats]);

  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function renderItem({ item }: { item: ChatSummary }) {
    return (
      <TouchableOpacity
        style={styles.chatRow}
        activeOpacity={0.7}
        onPress={() => onOpenChat(item.id, item.sellerName)}
      >
        {item.sellerImage ? (
          <Image source={{ uri: item.sellerImage }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={20} color="#FFFFFF" />
          </View>
        )}
        <View style={styles.chatBody}>
          <View style={styles.chatTopRow}>
            <Text style={styles.chatName} numberOfLines={1}>{item.sellerName}</Text>
            <Text style={styles.chatTime}>{formatTime(item.lastMessageTime)}</Text>
          </View>
          <Text style={styles.chatPreview} numberOfLines={1}>
            {item.lastMessage || t('helper.chatList.emptyPreview')}
          </Text>
        </View>
        {item.buyerUnreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.buyerUnreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.chatList.title')} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('status.chatList.loading')} />
      ) : chats.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={t('headline.chatList.emptyTitle')}
          subtitle={t('helper.chatList.emptySubtitle')}
        />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchChats(true); }} tintColor={theme.primary} />
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
  list: { paddingBottom: 40 },
  sep: { height: 1, backgroundColor: '#F0EBE4', marginHorizontal: 16 },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.primary },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  chatBody: { flex: 1 },
  chatTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName: { color: theme.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  chatTime: { color: '#9B8E80', fontSize: 12 },
  chatPreview: { color: '#71685F', fontSize: 13, marginTop: 2 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
