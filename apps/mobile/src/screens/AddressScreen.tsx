import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { readJsonSafe } from '../utils/http';
import { formatCopy, t } from '../copy/brandCopy';

type Address = {
  id: string;
  title: string;
  addressLine: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function AddressScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form modal state
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formDefault, setFormDefault] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  useEffect(() => {
    fetchAddresses();
  }, []);

  async function authedFetch(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentAuth.accessToken}`,
        ...(options?.headers ?? {}),
      },
    });

    if (response.status === 401) {
      const settings = await loadSettings();
      const refreshed = await refreshAuthSession(settings.apiUrl, currentAuth);
      if (refreshed) {
        setCurrentAuth(refreshed);
        onAuthRefresh?.(refreshed);
        return fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshed.accessToken}`,
            ...(options?.headers ?? {}),
          },
        });
      }
    }

    return response;
  }

  async function fetchAddresses() {
    setLoading(true);
    setError(null);
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me/addresses`);
      const json = await readJsonSafe<{ data?: Address[]; error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? formatCopy('error.common.statusCode', { status: res.status }));
      }
      setAddresses(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.address.load'));
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setEditingId(null);
    setFormTitle('');
    setFormAddress('');
    setFormDefault(addresses.length === 0);
    setFormError(null);
    setFormVisible(true);
  }

  function openEditForm(addr: Address) {
    setEditingId(addr.id);
    setFormTitle(addr.title);
    setFormAddress(addr.addressLine);
    setFormDefault(addr.isDefault);
    setFormError(null);
    setFormVisible(true);
  }

  async function handleSaveForm() {
    if (!formTitle.trim()) {
      setFormError(t('error.address.titleRequired'));
      return;
    }
    const trimmedAddress = formAddress.trim();
    if (!trimmedAddress || trimmedAddress.length < 10) {
      setFormError(t('error.address.addressTooShortDetailed'));
      return;
    }
    const words = trimmedAddress.split(/\s+/).filter((w: string) => w.length > 0);
    if (words.length < 2) {
      setFormError(t('error.address.addressFormat'));
      return;
    }

    setFormSaving(true);
    setFormError(null);
    try {
      const { apiUrl } = await loadSettings();
      const body = {
        title: formTitle.trim(),
        addressLine: formAddress.trim(),
        isDefault: formDefault,
      };

      let res: Response;
      if (editingId) {
        res = await authedFetch(`${apiUrl}/v1/auth/me/addresses/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        res = await authedFetch(`${apiUrl}/v1/auth/me/addresses`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      const json = await readJsonSafe<{ error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? formatCopy('error.common.statusCode', { status: res.status }));
      }

      setFormVisible(false);
      await fetchAddresses();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('error.address.save'));
    } finally {
      setFormSaving(false);
    }
  }

  function handleDelete(addr: Address) {
    Alert.alert(
      t('helper.address.deleteTitle'),
      `"${addr.title}" ${t('helper.address.deleteMessage')}`,
      [
        { text: t('cta.address.cancel'), style: 'cancel' },
        {
          text: t('cta.address.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { apiUrl } = await loadSettings();
              const res = await authedFetch(`${apiUrl}/v1/auth/me/addresses/${addr.id}`, {
                method: 'DELETE',
              });
              if (!res.ok && res.status !== 204) {
                const json = await readJsonSafe<{ error?: { message?: string } }>(res);
                throw new Error(json.error?.message ?? t('error.address.delete'));
              }
              await fetchAddresses();
            } catch (e) {
              Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.address.delete'));
            }
          },
        },
      ]
    );
  }

  async function handleSetDefault(addr: Address) {
    if (addr.isDefault) return;
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me/addresses/${addr.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      const json = await readJsonSafe<{ error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? t('error.address.default'));
      }
      await fetchAddresses();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.address.default'));
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('headline.address.title')}</Text>
        <TouchableOpacity onPress={openAddForm} style={styles.addBtn}>
          <Ionicons name="add" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchAddresses}>
              <Text style={styles.retryText}>{t('cta.address.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : addresses.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="location-outline" size={56} color={theme.border} />
            <Text style={styles.emptyTitle}>{t('headline.address.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('helper.address.emptySubtitle')}</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={openAddForm}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.emptyBtnText}>{t('cta.address.add')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {addresses.map((addr) => (
              <View key={addr.id} style={[styles.card, addr.isDefault && styles.cardDefault]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleRow}>
                    {addr.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Ionicons name="checkmark-circle" size={14} color={theme.primary} />
                        <Text style={styles.defaultBadgeText}>{t('status.address.default')}</Text>
                      </View>
                    )}
                    <Text style={styles.cardTitle}>{addr.title}</Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => openEditForm(addr)} style={styles.iconBtn}>
                      <Ionicons name="create-outline" size={20} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(addr)} style={styles.iconBtn}>
                      <Ionicons name="trash-outline" size={20} color={theme.error} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.cardAddress}>{addr.addressLine}</Text>
                {!addr.isDefault && (
                  <TouchableOpacity style={styles.setDefaultBtn} onPress={() => handleSetDefault(addr)}>
                    <Ionicons name="locate-outline" size={16} color={theme.primary} />
                    <Text style={styles.setDefaultText}>{t('cta.address.setDefault')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={formVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalWrap}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editingId ? t('headline.address.edit') : t('headline.address.new')}
                </Text>
                <TouchableOpacity onPress={() => setFormVisible(false)}>
                  <Ionicons name="close" size={24} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalForm}>
                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.address.titleLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={formTitle}
                    onChangeText={setFormTitle}
                    placeholder={t('helper.address.titlePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    maxLength={80}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.address.addressLabel')}</Text>
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    value={formAddress}
                    onChangeText={setFormAddress}
                    placeholder={t('helper.address.addressPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    numberOfLines={3}
                    maxLength={500}
                    textAlignVertical="top"
                  />
                </View>

                <TouchableOpacity
                  style={styles.defaultToggle}
                  onPress={() => setFormDefault(!formDefault)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={formDefault ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={formDefault ? theme.primary : theme.textSecondary}
                  />
                  <Text style={styles.defaultToggleText}>{t('helper.address.defaultToggle')}</Text>
                </TouchableOpacity>

                {formError && (
                  <View style={styles.formErrorBox}>
                    <Text style={styles.formErrorText}>{formError}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.saveBtn, formSaving && styles.saveBtnDisabled]}
                  onPress={handleSaveForm}
                  disabled={formSaving}
                  activeOpacity={0.8}
                >
                  {formSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {editingId ? t('cta.address.update') : t('cta.address.save')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontSize: 18, fontWeight: '700' },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  errorText: { color: theme.error, fontSize: 14, textAlign: 'center' },
  retryBtn: { backgroundColor: theme.buttonPassiveBg, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: theme.buttonPassiveText, fontSize: 14, fontWeight: '600' },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  emptySubtitle: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 16,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Address list
  list: { gap: 12 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cardDefault: {
    borderColor: theme.primary,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitleRow: { flex: 1, gap: 4 },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  defaultBadgeText: { color: theme.primary, fontSize: 11, fontWeight: '600' },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  cardAddress: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  setDefaultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.buttonPassiveBg,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  setDefaultText: { color: theme.primary, fontSize: 13, fontWeight: '600' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalWrap: { justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: theme.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '700' },
  modalForm: { gap: 16 },
  field: { gap: 6 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: theme.text,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 80,
    paddingTop: 14,
  },
  defaultToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  defaultToggleText: { color: theme.text, fontSize: 14 },
  formErrorBox: {
    backgroundColor: '#FDF2F2',
    borderRadius: 10,
    padding: 10,
  },
  formErrorText: { color: theme.error, fontSize: 13 },
  saveBtn: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
