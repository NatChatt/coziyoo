import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { readJsonSafe } from '../utils/http';
import { t } from '../copy/brandCopy';
import ProfileEditScreen from './ProfileEditScreen';
import AddressScreen from './AddressScreen';

type UserProfile = {
  email: string;
  phone: string | null;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenComplaintOrders: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function SettingsScreen({ auth, onBack, onOpenComplaintOrders, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [profileEditModalVisible, setProfileEditModalVisible] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    void fetchProfile();
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

  async function fetchProfile() {
    setLoading(true);
    setError(null);
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me`);
      const json = await readJsonSafe<{ data?: UserProfile; error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Hata (${res.status})`);
      }
      const data = json.data;
      setEmail(data?.email ?? '');
      setPhone(data?.phone?.trim() || t('status.security.phoneFallback'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.settings.load'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendResetCode() {
    setPasswordLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me/password-reset/request`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json = await readJsonSafe<{ error?: { message?: string } }>(res);
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Hata (${res.status})`);
      }
      Alert.alert(t('status.security.passwordTitle'), t('status.profileEdit.resetCodeSent'));
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.profileEdit.save'));
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4EF" />

      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color="#332C25" />
          <Text style={styles.backText}>{t('cta.settings.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('headline.settings.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{t('helper.settings.securitySubtitle')}</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#3F855C" />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: '#F18E33' }]}>
                  <Ionicons name="lock-closed" size={18} color="#fff" />
                </View>
                <View style={styles.headTextWrap}>
                  <Text style={styles.cardTitle}>{t('status.security.passwordTitle')}</Text>
                  <Text style={styles.cardValue}>********</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.buttonOutline, passwordLoading && styles.buttonDisabled]}
                onPress={() => void handleSendResetCode()}
                disabled={passwordLoading}
                activeOpacity={0.85}
              >
                {passwordLoading ? (
                  <ActivityIndicator size="small" color="#3E845B" />
                ) : (
                  <Text style={styles.buttonOutlineText}>{t('cta.security.changePassword')}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.cardMeta}>{t('helper.settings.passwordLastChanged')}</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: '#4B90DE' }]}>
                  <Ionicons name="mail" size={18} color="#fff" />
                </View>
                <View style={styles.headTextWrap}>
                  <Text style={styles.cardTitle}>{t('status.security.emailVerification')}</Text>
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>{t('status.profileEdit.verified')}</Text>
                    <Ionicons name="checkmark" size={13} color="#3E845B" />
                  </View>
                </View>
              </View>
              <Text style={styles.cardValue}>{email || '-'}</Text>
              <TouchableOpacity
                style={styles.buttonSoft}
                onPress={() => setProfileEditModalVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonSoftText}>{t('cta.security.changeEmail')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: '#8452B7' }]}>
                  <Ionicons name="call" size={18} color="#fff" />
                </View>
                <View style={styles.headTextWrap}>
                  <Text style={styles.cardTitle}>{t('status.security.phoneVerification')}</Text>
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>{t('status.profileEdit.verified')}</Text>
                    <Ionicons name="checkmark" size={13} color="#3E845B" />
                  </View>
                </View>
              </View>
              <Text style={styles.cardValue}>{phone}</Text>
              <TouchableOpacity
                style={styles.buttonSoft}
                onPress={() => setProfileEditModalVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonSoftText}>{t('cta.security.changePhone')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: '#BFC2C5' }]}>
                  <Ionicons name="shield-checkmark" size={18} color="#fff" />
                </View>
                <View style={styles.headTextWrap}>
                  <Text style={styles.cardTitle}>{t('status.security.twoFactorTitle')}</Text>
                  <Text style={styles.cardMetaInline}>{t('helper.settings.twoFactorSubtitle')}</Text>
                  <Text style={styles.cardMetaInline}>{t('status.security.off')}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.buttonSoft}
                onPress={() => Alert.alert(t('status.security.twoFactorTitle'), t('helper.settings.twoFactorComingSoon'))}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonSoftText}>{t('cta.security.enable')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWrap, { backgroundColor: '#C4513D' }]}>
                  <Ionicons name="flag" size={18} color="#fff" />
                </View>
              <View style={styles.headTextWrap}>
                  <Text style={styles.cardTitle}>Destek Ticketları</Text>
                  <Text style={styles.cardMetaInline}>Ticketlarını gör, detaydan mesaj at, gerekirse yenisini aç.</Text>
              </View>
              </View>
              <TouchableOpacity
                style={styles.buttonSoft}
                onPress={onOpenComplaintOrders}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonSoftText}>Ticketları Aç</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoHeadRow}>
                <Ionicons name="information-circle-outline" size={24} color="#3A83E2" />
                <Text style={styles.infoTitle}>{t('headline.settings.whyImportant')}</Text>
              </View>
              <Text style={styles.infoBody}>{t('helper.settings.whyImportantBody')}</Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.doneBtn} onPress={onBack} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>{t('cta.settings.done')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal
        visible={profileEditModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileEditModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setProfileEditModalVisible(false)}
          />
          <View style={styles.profileEditSheet}>
            <ProfileEditScreen
              auth={currentAuth}
              onBack={() => setProfileEditModalVisible(false)}
              onAuthRefresh={(session) => {
                setCurrentAuth(session);
                onAuthRefresh?.(session);
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={addressModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddressModalVisible(false)}
      >
        <View style={styles.profileEditOverlay}>
          <TouchableOpacity
            style={styles.profileEditBackdrop}
            activeOpacity={1}
            onPress={() => setAddressModalVisible(false)}
          />
          <View style={styles.profileEditSheet}>
            <AddressScreen
              auth={currentAuth}
              onBack={() => setAddressModalVisible(false)}
              onAuthRefresh={(session) => {
                setCurrentAuth(session);
                onAuthRefresh?.(session);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4EF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: { width: 76, flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: '#332C25', fontSize: 18 / 2, fontWeight: '500' },
  headerTitle: { color: '#2D2722', fontSize: 18, fontWeight: '700' },
  headerSpacer: { width: 76 },
  content: { paddingHorizontal: 16, paddingBottom: 36, gap: 14 },
  subtitle: { color: '#3E3630', fontSize: 30 / 2, marginTop: 6, marginBottom: 2 },
  loadingBox: { paddingTop: 70, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#FCFBF9',
    borderWidth: 1,
    borderColor: '#E2DBD2',
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headTextWrap: { flex: 1 },
  cardTitle: { color: '#2E2924', fontSize: 33 / 2, fontWeight: '700' },
  cardValue: { color: '#2E2924', fontSize: 32 / 2, fontWeight: '600' },
  cardMeta: { color: '#6E665E', fontSize: 13 },
  cardMetaInline: { color: '#6E665E', fontSize: 13, lineHeight: 18 },
  buttonOutline: {
    borderWidth: 1.5,
    borderColor: '#4E956A',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonOutlineText: { color: '#3E845B', fontSize: 15, fontWeight: '700' },
  buttonSoft: {
    backgroundColor: '#EFEBE7',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonSoftText: { color: '#3F3730', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.65 },
  verifiedBadge: {
    marginTop: 4,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E5F2E8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verifiedText: { color: '#3E845B', fontSize: 13, fontWeight: '700' },
  infoCard: {
    borderWidth: 1.5,
    borderColor: '#72A8EB',
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  infoHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoTitle: { color: '#2E2924', fontSize: 17, fontWeight: '700' },
  infoBody: { color: '#4B433C', fontSize: 14, lineHeight: 21 },
  error: { color: '#C23E3E', fontSize: 13, textAlign: 'center' },
  doneBtn: {
    marginTop: 6,
    backgroundColor: '#2F8658',
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: { color: '#FFFFFF', fontSize: 31 / 2, fontWeight: '700' },
  profileEditOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  profileEditBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  profileEditSheet: {
    height: '82%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F7F4EF',
  },
});
