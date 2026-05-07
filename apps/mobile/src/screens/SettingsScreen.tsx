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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { readJsonSafe } from '../utils/http';
import { formatCopy, t } from '../copy/brandCopy';
import ScreenHeader from '../components/ScreenHeader';

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenComplaintOrders: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function SettingsScreen({ auth, onBack, onOpenComplaintOrders, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [appLanguage, setAppLanguage] = useState<AppSettings['language']>('tr');

  useEffect(() => {
    setCurrentAuth((prev) => (prev.accessToken === auth.accessToken ? prev : auth));
  }, [auth.accessToken]);

  useEffect(() => {
    loadSettings().then((settings) => setAppLanguage(settings.language)).catch(() => {});
    return subscribeSettings((settings) => setAppLanguage(settings.language));
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
        throw new Error(json.error?.message ?? formatCopy('error.common.statusCode', { status: res.status }));
      }
      Alert.alert(t('status.security.passwordTitle'), t('status.profileEdit.resetCodeSent'));
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.profileEdit.save'));
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleLanguageChange(language: AppSettings['language']) {
    const settings = await loadSettings();
    await saveSettings({ ...settings, language });
    setAppLanguage(language);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4EF" />

      <ScreenHeader title={t('headline.settings.title')} onBack={onBack} borderBottom={false} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{t('helper.settings.securitySubtitle')}</Text>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.iconWrap, { backgroundColor: '#3E845B' }]}>
              <Ionicons name="language" size={18} color="#fff" />
            </View>
            <View style={styles.headTextWrap}>
              <Text style={styles.cardTitle}>{t('status.settings.language')}</Text>
              <Text style={styles.cardMetaInline}>{t('helper.home.generalSettingsLanguageHint')}</Text>
            </View>
          </View>
          <View style={styles.languageRow}>
            <TouchableOpacity
              style={[styles.languageBtn, appLanguage === 'tr' && styles.languageBtnActive]}
              onPress={() => void handleLanguageChange('tr')}
              activeOpacity={0.9}
            >
              <Text style={[styles.languageBtnText, appLanguage === 'tr' && styles.languageBtnTextActive]}>
                {t('cta.home.languageTurkish')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.languageBtn, appLanguage === 'en' && styles.languageBtnActive]}
              onPress={() => void handleLanguageChange('en')}
              activeOpacity={0.9}
            >
              <Text style={[styles.languageBtnText, appLanguage === 'en' && styles.languageBtnTextActive]}>
                {t('cta.home.languageEnglish')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

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
              <Text style={styles.cardTitle}>{t('headline.settings.supportTickets')}</Text>
              <Text style={styles.cardMetaInline}>{t('helper.settings.supportTicketsBody')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.buttonSoft}
            onPress={onOpenComplaintOrders}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonSoftText}>{t('cta.settings.openTickets')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoHeadRow}>
            <Ionicons name="information-circle-outline" size={24} color="#3A83E2" />
            <Text style={styles.infoTitle}>{t('headline.settings.whyImportant')}</Text>
          </View>
          <Text style={styles.infoBody}>{t('helper.settings.whyImportantBody')}</Text>
        </View>

        <TouchableOpacity style={styles.doneBtn} onPress={onBack} activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>{t('cta.settings.done')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4EF' },
  content: { paddingHorizontal: 16, paddingBottom: 36, gap: 14 },
  subtitle: { color: '#3E3630', fontSize: 30 / 2, marginTop: 6, marginBottom: 2 },
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
  languageRow: { flexDirection: 'row', gap: 10 },
  languageBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8D0C4',
    backgroundColor: '#F6F2ED',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  languageBtnActive: {
    backgroundColor: '#E6F1E9',
    borderColor: '#3E845B',
  },
  languageBtnText: { color: '#3F3730', fontSize: 15, fontWeight: '700' },
  languageBtnTextActive: { color: '#2E6B44' },
  buttonDisabled: { opacity: 0.65 },
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
  doneBtn: {
    marginTop: 6,
    backgroundColor: '#2F8658',
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: { color: '#FFFFFF', fontSize: 31 / 2, fontWeight: '700' },
});
