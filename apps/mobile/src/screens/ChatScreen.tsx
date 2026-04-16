import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import { subscribeChatRealtime } from '../utils/realtime';
import ScreenHeader from '../components/ScreenHeader';
import LoadingState from '../components/LoadingState';
import { t } from '../copy/brandCopy';

type Message = {
  id: string;
  senderId: string;
  senderType: 'buyer' | 'seller';
  message: string | null;
  messageType: 'text' | 'image' | 'order_update';
  isRead: boolean;
  createdAt: string;
};

type Props = {
  auth: AuthSession;
  chatId: string;
  sellerName: string;
  actorRole?: 'buyer' | 'seller';
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ChatScreen({ auth, chatId, sellerName, actorRole = 'buyer', onBack, onAuthRefresh }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const result = await apiRequest<Message[]>(
      `/v1/chats/${chatId}/messages`,
      auth,
      { actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setMessages(Array.isArray(result.data) ? result.data : []);
    }
    setLoading(false);
  }, [actorRole, chatId, auth.accessToken, auth.userId, onAuthRefresh]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => subscribeChatRealtime(chatId, fetchMessages), [chatId, fetchMessages]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const result = await apiRequest<Message>(
      `/v1/chats/${chatId}/messages`,
      auth,
      { method: 'POST', body: { message: trimmed, messageType: 'text' }, actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setText('');
      fetchMessages();
    }
    setSending(false);
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  function renderMessage({ item }: { item: Message }) {
    const isMine = item.senderType === actorRole;

    return (
      <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {item.message ?? ''}
          </Text>
          <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={sellerName} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('status.chatList.loading')} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          renderItem={renderMessage}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('helper.chat.inputPlaceholder')}
          placeholderTextColor={theme.textSecondary}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          <Ionicons name="send" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  messageList: { padding: 16, paddingBottom: 8 },
  bubbleRow: { marginBottom: 8, alignItems: 'flex-start' },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: theme.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: '#FCFBF9',
    borderWidth: 1,
    borderColor: '#E6DDD3',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: theme.text, fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: '#FFFFFF' },
  bubbleTime: { color: '#9B8E80', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.7)' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
    backgroundColor: '#FCFBF9',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: theme.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
