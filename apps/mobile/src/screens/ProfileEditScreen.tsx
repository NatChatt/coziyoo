import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { formatCopy, t } from '../copy/brandCopy';
import ScreenHeader from '../components/ScreenHeader';
import { getSessionScreenCache, setSessionScreenCache } from '../utils/sessionScreenCache';

type UserProfile = {
  id: string;
  email: string;
  username?: string | null;
  fullName: string | null;
  userType: string;
  countryCode: string | null;
  nationalId?: string | null;
  phone: string | null;
  dob: string | null;
  profileImageUrl: string | null;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
  isNewRegistration?: boolean;
};

async function readJsonSafe<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export default function ProfileEditScreen({ auth, onBack, onAuthRefresh, isNewRegistration }: Props) {
  const cacheOwnerKey = auth.userId;
  const initialProfileCache = isNewRegistration ? null : getSessionScreenCache<UserProfile>('userProfile', cacheOwnerKey);
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [loading, setLoading] = useState(() => initialProfileCache === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [username, setUsername] = useState(() => initialProfileCache?.username ?? '');
  const [fullName, setFullName] = useState(() => initialProfileCache?.fullName ?? '');
  const [phone, setPhone] = useState(() => initialProfileCache?.phone ?? '');
  const [dob, setDob] = useState(() => normalizeDobValue(initialProfileCache?.dob));
  const [tcKimlikNo, setTcKimlikNo] = useState(() => initialProfileCache?.nationalId ?? '');
  const [email, setEmail] = useState(() => initialProfileCache?.email ?? '');
  const [editField, setEditField] = useState<'username' | 'fullName' | 'phone' | 'dob' | 'email' | 'tcKimlikNo' | null>(null);
  const [editValue, setEditValue] = useState('');
  const fallbackEmail = currentAuth.email || auth.email || '';

  function nonEmptyOrCurrent(nextValue: string | null | undefined, currentValue: string): string {
    const next = String(nextValue ?? '').trim();
    return next || currentValue;
  }

  function applyProfileState(data?: UserProfile | null) {
    if (!data) return;
    setUsername((prev) => nonEmptyOrCurrent(data.username, prev));
    setFullName((prev) => nonEmptyOrCurrent(data.fullName, prev));
    setPhone((prev) => nonEmptyOrCurrent(data.phone, prev));
    setDob((prev) => nonEmptyOrCurrent(normalizeDobValue(data.dob), prev));
    setTcKimlikNo((prev) => nonEmptyOrCurrent(data.nationalId, prev));
    setEmail((prev) => nonEmptyOrCurrent(data.email?.trim() || fallbackEmail, prev));
  }

  function normalizeDobValue(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) return '';
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
    const digits = datePart.replace(/\D/g, '').slice(0, 8);
    if (digits.length === 8) {
      // API formatı YYYY-MM-DD, UI formatı DD-MM-YYYY
      if (datePart.includes('-') && datePart.split('-')[0]?.length === 4) {
        return `${digits.slice(6, 8)}-${digits.slice(4, 6)}-${digits.slice(0, 4)}`;
      }
      return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}`;
    }
    return datePart;
  }

  function toApiDob(value: string): string | null {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length !== 8) return null;
    const day = digits.slice(0, 2);
    const month = digits.slice(2, 4);
    const year = digits.slice(4, 8);
    return `${year}-${month}-${day}`;
  }

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  useEffect(() => {
    if (isNewRegistration && auth.email) {
      setEmail(auth.email);
    }
    fetchProfile({ silent: initialProfileCache !== null });
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

  async function fetchProfile(options?: { silent?: boolean }) {
    const hasCache = getSessionScreenCache<UserProfile>('userProfile', cacheOwnerKey) !== null;
    if (!options?.silent && !hasCache) setLoading(true);
    if (!hasCache) setError(null);
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me`);
      const json = await readJsonSafe<{ data?: UserProfile; error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? formatCopy('error.profileEdit.statusCode', { status: res.status }));
      }
      const data = (json.data ?? null) as UserProfile | null;
      if (data) setSessionScreenCache('userProfile', cacheOwnerKey, data);
      applyProfileState(data);
    } catch (e) {
      if (!hasCache) setError(e instanceof Error ? e.message : t('helper.profileEdit.load'));
    } finally {
      setLoading(false);
    }
  }

  function isProfileComplete(): boolean {
    return !!(
      fullName.trim() &&
      phone.trim() &&
      dob.trim()
    );
  }

  async function handleSave() {
    if (isNewRegistration) {
      if (!fullName.trim()) { Alert.alert(t('headline.common.error'), t('error.profileEdit.fullNameRequired')); return; }
      if (!phone.trim()) { Alert.alert(t('headline.common.error'), t('error.profileEdit.phoneRequired')); return; }
      if (!dob.trim()) { Alert.alert(t('headline.common.error'), t('error.profileEdit.dobRequired')); return; }
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const { apiUrl } = await loadSettings();
      const body: Record<string, string> = {};
      if (username.trim()) body.username = username.trim().replace(/^@+/, "");
      if (fullName.trim()) body.fullName = fullName.trim();
      if (phone.trim()) body.phone = phone.trim();
      if (dob.trim()) {
        const apiDob = toApiDob(dob.trim());
        if (!apiDob) {
          Alert.alert(t('headline.common.error'), t('error.profileEdit.dobFormat'));
          setSaving(false);
          return;
        }
        body.dob = apiDob;
      }
      const nationalIdInput = tcKimlikNo.trim();
      body.nationalId = /^\d{11}$/.test(nationalIdInput) ? nationalIdInput : '11111111111';
      if (email.trim()) body.email = email.trim();

      const res = await authedFetch(`${apiUrl}/v1/auth/me`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const json = await readJsonSafe<{ data?: UserProfile; error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? formatCopy('error.profileEdit.statusCode', { status: res.status }));
      }
      const data = (json.data ?? null) as UserProfile | null;
      if (data) setSessionScreenCache('userProfile', cacheOwnerKey, data);
      applyProfileState(data);
      setSuccess(true);
      setTimeout(() => onBack(), isNewRegistration ? 800 : 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.profileEdit.save'));
    } finally {
      setSaving(false);
    }
  }

  function openFieldEditor(field: 'username' | 'fullName' | 'phone' | 'dob' | 'email' | 'tcKimlikNo') {
    if (field === 'username') setEditValue(username);
    if (field === 'fullName') setEditValue(fullName);
    if (field === 'phone') setEditValue(phone);
    if (field === 'dob') setEditValue(dob);
    if (field === 'email') setEditValue(email);
    if (field === 'tcKimlikNo') setEditValue(tcKimlikNo);
    setEditField(field);
  }

  function applyFieldEdit() {
    if (!editField) return;
    const next = editValue.trim();
    if (editField === 'username') setUsername(next.replace(/^@+/, ""));
    if (editField === 'fullName') setFullName(next);
    if (editField === 'phone') setPhone(next);
    if (editField === 'dob') setDob(next);
    if (editField === 'email') setEmail(next);
    if (editField === 'tcKimlikNo') setTcKimlikNo(next);
    setEditField(null);
  }

  function getEditPlaceholder() {
    if (editField === 'username') return t('helper.profileEdit.usernamePlaceholder');
    if (editField === 'fullName') return t('helper.profileEdit.fullNamePlaceholder');
    if (editField === 'phone') return t('helper.profileEdit.phonePlaceholder');
    if (editField === 'dob') return t('helper.profileEdit.dobPlaceholder');
    if (editField === 'email') return t('helper.profileEdit.emailHint');
    if (editField === 'tcKimlikNo') return t('helper.profileEdit.countryPlaceholder');
    return "";
  }

  function formatDobInput(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}`;
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />

      <ScreenHeader
        title={isNewRegistration ? t('headline.profileEdit.completeTitle') : t('headline.profileEdit.title')}
        onBack={onBack}
        hideBack={isNewRegistration}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <>
              {isNewRegistration && (
                <View style={styles.mandatoryBanner}>
                  <Ionicons name="information-circle" size={18} color={theme.primary} />
                  <Text style={styles.mandatoryBannerText}>
                    Devam etmek için tüm alanları doldurman gerekiyor
                  </Text>
                </View>
              )}

              <View style={styles.cardsWrap}>
                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#435B8A' }]}>
                      <Ionicons name="at" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.usernameLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.usernameHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('username')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{username ? `@${username.replace(/^@+/, "")}` : '-'}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#DCD2C3' }]}>
                      <Ionicons name="card-outline" size={18} color="#6F604F" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.fullNameLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.fullNameHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('fullName')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{fullName || '-'}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#8A4FA4' }]}>
                      <Ionicons name="call" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.phoneLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.phoneHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('phone')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{phone || t('helper.profileEdit.phonePlaceholder')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#E9C298' }]}>
                      <Ionicons name="calendar-outline" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.dobLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.dobHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('dob')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{dob || t('helper.profileEdit.dobPlaceholder')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#C0392B' }]}>
                      <Ionicons name="id-card-outline" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.countryLabel')}</Text>
                      <Text style={styles.infoSubtitle}>11 haneli TC kimlik numarası</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('tcKimlikNo')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{tcKimlikNo || t('helper.profileEdit.countryPlaceholder')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#9FB6D8' }]}>
                      <Ionicons name="mail" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.emailLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.emailHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('email')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.emailRow}>
                    <Text style={styles.infoValue}>{email || fallbackEmail || '-'}</Text>
                    <View style={styles.verifiedBadge}>
                      <Ionicons name="checkmark-circle" size={18} color="#3E845B" />
                    </View>
                  </View>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={theme.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {success ? (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
                  <Text style={styles.successText}>{t('status.profileEdit.saved')}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
        {!loading ? (
          <View style={styles.footerAction}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={() => void handleSave()}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>{t('cta.profileEdit.save')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Modal
        visible={!!editField}
        transparent
        animationType="fade"
        onRequestClose={() => setEditField(null)}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>{t('cta.profileEdit.edit')}</Text>
            <TextInput
              style={styles.editModalInput}
              value={editValue}
              onChangeText={(value) => {
                if (editField === 'dob') {
                  setEditValue(formatDobInput(value));
                  return;
                }
                setEditValue(value);
              }}
              placeholder={getEditPlaceholder()}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize={editField === 'phone' || editField === 'email' || editField === 'dob' || editField === 'username' || editField === 'tcKimlikNo' ? 'none' : 'words'}
              keyboardType={editField === 'phone' ? 'phone-pad' : editField === 'email' ? 'email-address' : editField === 'dob' ? 'numbers-and-punctuation' : editField === 'tcKimlikNo' ? 'numeric' : 'default'}
              maxLength={editField === 'phone' ? 20 : editField === 'dob' ? 10 : editField === 'username' ? 30 : editField === 'tcKimlikNo' ? 11 : 120}
              autoFocus
            />
            <View style={styles.editModalActions}>
              <TouchableOpacity style={styles.editModalCancel} onPress={() => setEditField(null)}>
                <Text style={styles.editModalCancelText}>{t('cta.address.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editModalSave} onPress={applyFieldEdit}>
                <Text style={styles.editModalSaveText}>{t('cta.profileEdit.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  mandatoryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F7F2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  mandatoryBannerText: {
    color: theme.primary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  cardsWrap: { gap: 12 },
  infoCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DDD7D0',
    backgroundColor: '#FCFBF9',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoHead: { flexDirection: 'row', alignItems: 'center' },
  infoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoHeadText: { flex: 1 },
  infoTitle: { color: '#332C25', fontSize: 18, fontWeight: '700' },
  infoSubtitle: { color: '#71685F', fontSize: 14, marginTop: 2 },
  editChip: {
    backgroundColor: '#EFEBE6',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editChipText: { color: '#4A423A', fontSize: 15, fontWeight: '700' },
  infoDivider: { height: 1, backgroundColor: '#E9E2D9', marginTop: 14, marginBottom: 12 },
  infoValue: { color: '#2F2924', fontSize: 38 / 2, fontWeight: '700' },
  emailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifiedBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4F2E7',
    borderRadius: 14,
    width: 28,
    height: 28,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDF2F2',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  errorText: { color: theme.error, fontSize: 13, flex: 1 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F7F2',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  successText: { color: theme.primary, fontSize: 13, fontWeight: '600' },

  saveBtn: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerAction: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  editModalCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
  },
  editModalTitle: { color: '#332C25', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  editModalInput: {
    borderWidth: 1,
    borderColor: '#DED4C8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#322B24',
    backgroundColor: '#FFFFFF',
    fontSize: 16,
  },
  editModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  editModalCancel: {
    backgroundColor: '#F0ECE6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  editModalCancelText: { color: '#5B5148', fontSize: 14, fontWeight: '600' },
  editModalSave: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  editModalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
