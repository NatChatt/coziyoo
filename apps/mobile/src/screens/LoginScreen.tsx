import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { readJsonSafe } from '../utils/http';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';

type Props = {
  onLogin: (session: AuthSession) => void;
  onGoToRegister?: () => void;
};

type LoginResponse = {
  data?: {
    user?: { id?: string; email?: string; userType?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string };
};

export default function LoginScreen({ onLogin, onGoToRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password state
  const [forgotModal, setForgotModal] = useState<'none' | 'email' | 'code' | 'newPassword'>('none');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotNewPasswordConfirm, setForgotNewPasswordConfirm] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Forgot email info modal
  const [showForgotEmailInfo, setShowForgotEmailInfo] = useState(false);

  function resolveLoginError(body: LoginResponse, status: number): string {
    const code = body?.error?.code;
    if (code === 'INVALID_CREDENTIALS') return t('error.login.invalidCredentials');
    if (code === 'ACCOUNT_LOCKED') return t('error.login.accountLocked');
    if (code === 'TOO_MANY_ATTEMPTS') return t('error.login.tooManyAttempts');
    return body?.error?.message ?? `${t('error.login.generic')} (${status})`;
  }

  async function loginWithCredentials(rawEmail: string, rawPassword: string) {
    const trimmedEmail = rawEmail.trim().toLowerCase();
    const trimmedPassword = rawPassword.trim();
    if (!trimmedEmail) {
      setError(t('error.login.emailRequired'));
      return;
    }
    if (!trimmedPassword) {
      setError(t('error.login.passwordRequired'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password: trimmedPassword }),
      });
      const json = await readJsonSafe<LoginResponse>(response);
      if (!response.ok || json.error) {
        setError(resolveLoginError(json, response.status));
        return;
      }
      const { user, tokens } = json.data ?? {};
      if (!tokens?.accessToken || !tokens?.refreshToken || !user?.id) {
        setError(t('error.login.unexpectedResponse'));
        return;
      }
      const session: AuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        userType: user.userType ?? 'buyer',
        email: user.email ?? trimmedEmail,
      };
      await saveAuthSession(session);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.login.network'));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    await loginWithCredentials(email, password);
  }

  async function handleQuickLogin(role: 'buyer' | 'seller') {
    const quickEmail = role === 'buyer' ? 'alici@coziyoo.com' : 'satici@coziyoo.com';
    const quickPassword = '12345678';
    setEmail(quickEmail);
    setPassword(quickPassword);
    await loginWithCredentials(quickEmail, quickPassword);
  }

  function openForgotPassword() {
    setForgotEmail(email.trim());
    setForgotCode('');
    setForgotNewPassword('');
    setForgotNewPasswordConfirm('');
    setForgotError(null);
    setForgotModal('email');
  }

  function closeForgotPassword() {
    setForgotModal('none');
    setForgotError(null);
  }

  async function handleForgotPasswordRequest() {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setForgotError(t('error.login.invalidEmail'));
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/forgot-password/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await readJsonSafe<{
        error?: { code?: string; message?: string; retryAfterSeconds?: number };
      }>(response);
      if (!response.ok) {
        const code = json?.error?.code;
        if (code === 'PASSWORD_RESET_TOO_FREQUENT') {
          setForgotError(t('error.login.retryAfterSeconds').replace('{seconds}', String(json.error?.retryAfterSeconds ?? 60)));
        } else {
          setForgotError(json?.error?.message ?? t('error.login.generic'));
        }
        return;
      }
      setForgotModal('code');
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : t('error.login.network'));
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleForgotPasswordConfirm() {
    if (!/^\d{6}$/.test(forgotCode)) {
      setForgotError(t('error.login.codeRequired'));
      return;
    }
    if (forgotNewPassword.length < 8) {
      setForgotError(t('error.profileEdit.passwordMin'));
      return;
    }
    if (forgotNewPassword !== forgotNewPasswordConfirm) {
      setForgotError(t('error.profileEdit.passwordMismatch'));
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/forgot-password/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim().toLowerCase(),
          code: forgotCode,
          newPassword: forgotNewPassword,
        }),
      });
      const json = await readJsonSafe<{ error?: { code?: string; message?: string } }>(response);
      if (!response.ok || json.error) {
        const code = json?.error?.code;
        if (code === 'PASSWORD_RESET_CODE_INVALID') setForgotError(t('error.login.codeInvalid'));
        else setForgotError(json?.error?.message ?? t('error.login.generic'));
        return;
      }
      closeForgotPassword();
      Alert.alert(t('headline.common.success'), t('status.login.passwordUpdated'));
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : t('error.login.network'));
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/images/coziyoo-logo-light-bg.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          </View>
          <Text style={styles.title}>{t('headline.login.title')}</Text>
          <Text style={styles.subtitle}>{t('headline.login.subtitle')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{t('helper.login.emailLabel')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder={t('helper.login.emailPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            editable={!loading}
          />

          <Text style={styles.label}>{t('helper.login.passwordLabel')}</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              placeholder={t('helper.login.passwordPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.forgotRow}>
            <TouchableOpacity onPress={() => setShowForgotEmailInfo(true)} activeOpacity={0.7}>
              <Text style={styles.forgotText}>{t('cta.login.forgotEmail')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openForgotPassword} activeOpacity={0.7}>
              <Text style={styles.forgotText}>{t('cta.login.forgotPassword')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, !!error && styles.buttonError, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>{error ? t('cta.login.tryAgain') : t('cta.login.signIn')}</Text>
            )}
          </TouchableOpacity>
          <View style={styles.quickLoginRow}>
            <TouchableOpacity
              style={[styles.quickLoginButton, loading && styles.buttonDisabled]}
              onPress={() => handleQuickLogin('buyer')}
              disabled={loading}
            >
              <Text style={styles.quickLoginText}>{t('cta.login.quickBuyerSignIn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickLoginButton, loading && styles.buttonDisabled]}
              onPress={() => handleQuickLogin('seller')}
              disabled={loading}
            >
              <Text style={styles.quickLoginText}>{t('cta.login.quickSellerSignIn')}</Text>
            </TouchableOpacity>
          </View>

          {onGoToRegister && (
            <TouchableOpacity onPress={onGoToRegister} style={styles.registerLink} activeOpacity={0.7}>
              <Text style={styles.registerLinkText}>{t('helper.login.noAccount')} <Text style={styles.registerLinkBold}>{t('cta.login.register')}</Text></Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Forgot Email Info Modal */}
      <Modal visible={showForgotEmailInfo} transparent animationType="fade" onRequestClose={() => setShowForgotEmailInfo(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('headline.login.forgotEmailTitle')}</Text>
            <Text style={styles.modalDesc}>{t('helper.login.forgotEmailBody')}</Text>
            <Text style={styles.modalDesc}>{t('helper.login.forgotEmailContact')}</Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowForgotEmailInfo(false)}>
              <Text style={styles.modalCloseBtnText}>{t('cta.login.ok')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Forgot Password Modal */}
      <Modal visible={forgotModal !== 'none'} transparent animationType="fade" onRequestClose={closeForgotPassword}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {forgotModal === 'email' && (
              <>
                <Text style={styles.modalTitle}>{t('headline.login.resetPassword')}</Text>
                <Text style={styles.modalDesc}>{t('helper.login.resetEmailDesc')}</Text>
                <TextInput
                  style={styles.modalInput}
                  value={forgotEmail}
                  onChangeText={(v) => { setForgotEmail(v); setForgotError(null); }}
                  placeholder={t('helper.login.emailPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                {!!forgotError && <Text style={styles.modalError}>{forgotError}</Text>}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={closeForgotPassword}>
                    <Text style={styles.modalCancelBtnText}>{t('cta.common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordRequest}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalPrimaryBtnText}>{t('cta.profileEdit.sendResetCode')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {forgotModal === 'code' && (
              <>
                <Text style={styles.modalTitle}>{t('headline.login.resetPassword')}</Text>
                <Text style={styles.modalDesc}>
                  {t('helper.login.resetCodeDesc').replace('{email}', forgotEmail)}
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={forgotCode}
                  onChangeText={(v) => { setForgotCode(v.replace(/\D/g, '').slice(0, 6)); setForgotError(null); }}
                  placeholder={t('helper.profileEdit.codePlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TextInput
                  style={styles.modalInput}
                  value={forgotNewPassword}
                  onChangeText={(v) => { setForgotNewPassword(v); setForgotError(null); }}
                  placeholder={t('helper.profileEdit.newPasswordPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                />
                <TextInput
                  style={styles.modalInput}
                  value={forgotNewPasswordConfirm}
                  onChangeText={(v) => { setForgotNewPasswordConfirm(v); setForgotError(null); }}
                  placeholder={t('helper.profileEdit.newPasswordAgainPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                />
                {!!forgotError && <Text style={styles.modalError}>{forgotError}</Text>}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setForgotModal('email')}>
                    <Text style={styles.modalCancelBtnText}>{t('cta.settings.back')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordConfirm}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalPrimaryBtnText}>{t('cta.profileEdit.changePassword')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoWrap: {
    width: 286,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: 4,
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  label: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
  },
  error: {
    color: theme.error,
    fontSize: 13,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  forgotText: {
    color: theme.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonError: {
    backgroundColor: theme.error,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  quickLoginRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickLoginButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.surface,
  },
  quickLoginText: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  registerLink: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
  },
  registerLinkText: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  registerLinkBold: {
    color: theme.primary,
    fontWeight: '700',
  },

  /* Modal styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalDesc: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
    marginBottom: 10,
  },
  modalError: {
    color: theme.error,
    fontSize: 13,
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelBtnText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalPrimaryBtn: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalPrimaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalCloseBtn: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalCloseBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
