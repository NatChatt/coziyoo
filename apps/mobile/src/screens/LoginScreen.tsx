import React, { useMemo, useState } from 'react';
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
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { readJsonSafe } from '../utils/http';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';

type Props = {
  onLogin: (session: AuthSession, options?: { isNewRegistration?: boolean; initialRole?: 'buyer' | 'seller' }) => void;
  onGoToRegister?: () => void;
};

type AuthStep = 'signIn' | 'signUp' | 'forgot' | 'resetSent' | 'newPassword' | 'phone' | 'otp' | 'roleChoice';

type AuthResponse = {
  data?: {
    user?: { id?: string; email?: string; userType?: string; displayName?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string; retryAfterSeconds?: number };
};

const AUTH_REQUEST_TIMEOUT_MS = 12000;

export default function LoginScreen({ onLogin }: Props) {
  const [step, setStep] = useState<AuthStep>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('+90 ');
  const [otp, setOtp] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [pendingSession, setPendingSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (step === 'signUp') return t('headline.auth.signUp');
    if (step === 'forgot') return t('headline.auth.forgotPassword');
    if (step === 'resetSent') return t('headline.auth.passwordReset');
    if (step === 'newPassword') return t('headline.auth.newPassword');
    if (step === 'phone' || step === 'otp') return t('headline.auth.verifyPhone');
    if (step === 'roleChoice') return 'Nasıl devam etmek istersin?';
    return t('headline.auth.signIn');
  }, [step]);

  function clearError() {
    setError(null);
  }

  function demoBuyerEmail(): string {
    return `alici_demo_${Date.now()}@coziyoo.test`;
  }

  function fillDemoBuyerSignUp() {
    setName('Demo Alıcı');
    setEmail(demoBuyerEmail());
    setPassword('12345678');
    setConfirmPassword('12345678');
    setPhone('+90 555 010 2026');
    setOtp('98');
    setError(null);
  }

  function openSignUp() {
    fillDemoBuyerSignUp();
    setStep('signUp');
  }

  function makeSession(json: AuthResponse, fallbackEmail: string): AuthSession | null {
    const { user, tokens } = json.data ?? {};
    if (!tokens?.accessToken || !tokens?.refreshToken || !user?.id) return null;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userId: user.id,
      userType: user.userType ?? 'buyer',
      email: user.email ?? fallbackEmail,
    };
  }

  function resolveLoginError(body: AuthResponse, status: number): string {
    const code = body?.error?.code;
    if (code === 'INVALID_CREDENTIALS') return t('error.login.invalidCredentials');
    if (code === 'ACCOUNT_LOCKED') return t('error.login.accountLocked');
    if (code === 'TOO_MANY_ATTEMPTS') return t('error.login.tooManyAttempts');
    return body?.error?.message ?? `${t('error.login.generic')} (${status})`;
  }

  async function fetchAuthEndpoint(path: string, body: Record<string, unknown>): Promise<Response> {
    const { apiUrl } = await loadSettings();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function resolveRequestError(err: unknown): string {
    if (err instanceof Error && err.name === 'AbortError') return t('error.login.network');
    return err instanceof Error ? err.message : t('error.login.network');
  }

  async function finishLogin(session: AuthSession, options?: { isNewRegistration?: boolean; initialRole?: 'buyer' | 'seller' }) {
    await saveAuthSession(session);
    onLogin(session, options);
  }

  async function saveVerifiedPhone(session: AuthSession) {
    const normalizedPhone = phone.trim();
    if (!normalizedPhone || normalizedPhone === '+90') return;
    try {
      const { apiUrl } = await loadSettings();
      await fetch(`${apiUrl}/v1/auth/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
    } catch {
      // Phone persistence is retried from profile completion if this request fails.
    }
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

    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuthEndpoint('/v1/auth/login', { email: trimmedEmail, password: trimmedPassword });
      const json = await readJsonSafe<AuthResponse>(response);
      if (!response.ok || json.error) {
        setError(resolveLoginError(json, response.status));
        return;
      }
      const session = makeSession(json, trimmedEmail);
      if (!session) {
        setError(t('error.login.unexpectedResponse'));
        return;
      }
      await finishLogin(session);
    } catch (err) {
      setError(resolveRequestError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickLogin(role: 'buyer' | 'seller') {
    const quickEmail = role === 'buyer' ? 'alici@coziyoo.com' : 'satici@coziyoo.com';
    const quickPassword = '12345678';
    setEmail(quickEmail);
    setPassword(quickPassword);
    await loginWithCredentials(quickEmail, quickPassword);
  }

  async function handleSignUp() {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedPassword = password.trim();
    if (!trimmedName) {
      setError(t('error.auth.nameRequired'));
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t('error.login.invalidEmail'));
      return;
    }
    if (trimmedPassword.length < 8) {
      setError(t('error.profileEdit.passwordMin'));
      return;
    }
    if (trimmedPassword !== confirmPassword.trim()) {
      setError(t('error.profileEdit.passwordMismatch'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const usernameSeed = trimmedEmail.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 24);
      const response = await fetchAuthEndpoint('/v1/auth/register', {
        email: trimmedEmail,
        password: trimmedPassword,
        username: `${usernameSeed}_${Date.now().toString().slice(-4)}`,
        displayName: trimmedName,
        userType: 'buyer',
      });
      const json = await readJsonSafe<AuthResponse>(response);
      if (!response.ok || json.error) {
        setError(json?.error?.message ?? t('error.login.generic'));
        return;
      }
      const session = makeSession(json, trimmedEmail);
      if (!session) {
        setError(t('error.login.unexpectedResponse'));
        return;
      }
      setPendingSession(session);
      setStep('phone');
    } catch (err) {
      setError(resolveRequestError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPasswordRequest() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('error.login.invalidEmail'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuthEndpoint('/v1/auth/forgot-password/request', { email: trimmed });
      const json = await readJsonSafe<AuthResponse>(response);
      if (!response.ok) {
        const code = json?.error?.code;
        if (code === 'PASSWORD_RESET_TOO_FREQUENT') {
          setError(t('error.login.retryAfterSeconds').replace('{seconds}', String(json.error?.retryAfterSeconds ?? 60)));
        } else {
          setError(json?.error?.message ?? t('error.login.generic'));
        }
        return;
      }
      setStep('resetSent');
    } catch (err) {
      setError(resolveRequestError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPassword() {
    if (!/^\d{6}$/.test(resetCode)) {
      setError(t('error.login.codeRequired'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('error.profileEdit.passwordMin'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(t('error.profileEdit.passwordMismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuthEndpoint('/v1/auth/forgot-password/confirm', {
        email: email.trim().toLowerCase(),
        code: resetCode,
        newPassword,
      });
      const json = await readJsonSafe<AuthResponse>(response);
      if (!response.ok || json.error) {
        const code = json?.error?.code;
        setError(code === 'PASSWORD_RESET_CODE_INVALID' ? t('error.login.codeInvalid') : json?.error?.message ?? t('error.login.generic'));
        return;
      }
      Alert.alert(t('headline.common.success'), t('status.login.passwordUpdated'));
      setStep('signIn');
    } catch (err) {
      setError(resolveRequestError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpVerify() {
    if (otp.replace(/\D/g, '').length < 2) {
      setError(t('error.auth.otpRequired'));
      return;
    }
    if (pendingSession) {
      setLoading(true);
      try {
        await saveVerifiedPhone(pendingSession);
        setStep('roleChoice');
      } finally {
        setLoading(false);
      }
      return;
    }
    setStep('signIn');
  }

  async function handleRegistrationRoleChoice(initialRole: 'buyer' | 'seller') {
    if (!pendingSession) {
      setStep('signIn');
      return;
    }
    await finishLogin(pendingSession, { isNewRegistration: true, initialRole });
  }

  function renderContent() {
    if (step === 'signUp') {
      return (
        <>
          <AuthInput icon="person-outline" label={t('helper.auth.nameLabel')} value={name} onChangeText={(v) => { setName(v); clearError(); }} placeholder={t('helper.auth.namePlaceholder')} />
          <AuthInput icon="mail-outline" label={t('helper.login.emailLabel')} value={email} onChangeText={(v) => { setEmail(v); clearError(); }} placeholder={t('helper.login.emailPlaceholder')} keyboardType="email-address" />
          <PasswordInput label={t('helper.login.passwordLabel')} value={password} onChangeText={(v) => { setPassword(v); clearError(); }} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          <PasswordInput label={t('helper.auth.confirmPasswordLabel')} value={confirmPassword} onChangeText={(v) => { setConfirmPassword(v); clearError(); }} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
          <PrimaryButton label={t('cta.login.register')} loading={loading} onPress={handleSignUp} />
          <InlineLink text={t('helper.auth.hasAccount')} actionText={t('cta.login.signIn')} onPress={() => setStep('signIn')} />
        </>
      );
    }

    if (step === 'forgot') {
      return (
        <>
          <Text style={styles.screenDesc}>{t('helper.auth.forgotBody')}</Text>
          <AuthInput icon="mail-outline" label={t('helper.login.emailLabel')} value={email} onChangeText={(v) => { setEmail(v); clearError(); }} placeholder={t('helper.login.emailPlaceholder')} keyboardType="email-address" />
          <PrimaryButton label={t('cta.profileEdit.sendResetCode')} loading={loading} onPress={handleForgotPasswordRequest} />
          <InlineLink text="" actionText={t('cta.settings.back')} onPress={() => setStep('signIn')} />
        </>
      );
    }

    if (step === 'resetSent') {
      return (
        <View style={styles.centerPanel}>
          <View style={styles.successRing}>
            <Ionicons name="lock-closed-outline" size={54} color="#819376" />
            <Ionicons name="refresh-outline" size={34} color="#819376" style={styles.successRefresh} />
          </View>
          <Text style={styles.successTitle}>{t('helper.auth.passwordResetSent')}</Text>
          <PrimaryButton label={t('cta.auth.sent')} loading={false} onPress={() => setStep('newPassword')} />
        </View>
      );
    }

    if (step === 'newPassword') {
      return (
        <>
          <Text style={styles.screenDesc}>{t('helper.auth.newPasswordBody')}</Text>
          <AuthInput icon="keypad-outline" label={t('helper.profileEdit.codeLabel')} value={resetCode} onChangeText={(v) => { setResetCode(v.replace(/\D/g, '').slice(0, 6)); clearError(); }} placeholder={t('helper.profileEdit.codePlaceholder')} keyboardType="number-pad" maxLength={6} />
          <PasswordInput label={t('helper.profileEdit.newPasswordLabel')} value={newPassword} onChangeText={(v) => { setNewPassword(v); clearError(); }} show={false} />
          <PasswordInput label={t('helper.profileEdit.newPasswordAgainLabel')} value={newPasswordConfirm} onChangeText={(v) => { setNewPasswordConfirm(v); clearError(); }} show={false} />
          <PrimaryButton label={t('cta.profileEdit.changePassword')} loading={loading} onPress={handleNewPassword} />
        </>
      );
    }

    if (step === 'phone') {
      return (
        <>
          <Text style={styles.screenDesc}>{t('helper.auth.phoneBody')}</Text>
          <AuthInput icon="call-outline" label={t('helper.profileEdit.phoneLabel')} value={phone} onChangeText={(v) => { setPhone(v); clearError(); }} placeholder={t('helper.profileEdit.phonePlaceholder')} keyboardType="phone-pad" />
          <PrimaryButton label={t('cta.auth.confirm')} loading={false} onPress={() => setStep('otp')} />
        </>
      );
    }

    if (step === 'otp') {
      const digits = otp.replace(/\D/g, '').slice(0, 5);
      return (
        <>
          <Text style={styles.screenDesc}>{t('helper.auth.otpBody')}</Text>
          <View style={styles.otpRow}>
            {[0, 1, 2, 3, 4].map((idx) => (
              <View key={idx} style={[styles.otpCell, digits[idx] ? styles.otpCellFilled : null]}>
                <Text style={styles.otpText}>{digits[idx] ?? ''}</Text>
              </View>
            ))}
          </View>
          <TextInput
            value={otp}
            onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 5)); clearError(); }}
            keyboardType="number-pad"
            style={styles.hiddenOtpInput}
            autoFocus
          />
          <TouchableOpacity onPress={() => setOtp('98')} activeOpacity={0.75}>
            <Text style={styles.resendText}>{t('helper.auth.otpResend')}</Text>
          </TouchableOpacity>
          <PrimaryButton label={t('cta.auth.verify')} loading={loading} onPress={handleOtpVerify} />
        </>
      );
    }

    if (step === 'roleChoice') {
      return (
        <>
          <Text style={styles.screenDesc}>Devam etmek istediğin yolu seç.</Text>
          <View style={styles.roleChoiceStack}>
            <TouchableOpacity style={styles.roleChoiceButton} onPress={() => void handleRegistrationRoleChoice('buyer')} activeOpacity={0.88}>
              <View style={styles.roleChoiceIcon}>
                <Ionicons name="person-outline" size={22} color="#819376" />
              </View>
              <View style={styles.roleChoiceTextWrap}>
                <Text style={styles.roleChoiceTitle}>Alıcı olarak devam et</Text>
                <Text style={styles.roleChoiceBody}>Profilini tamamla ve yemek keşfetmeye başla.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#819376" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.roleChoiceButton} onPress={() => void handleRegistrationRoleChoice('seller')} activeOpacity={0.88}>
              <View style={styles.roleChoiceIcon}>
                <Ionicons name="storefront-outline" size={22} color="#819376" />
              </View>
              <View style={styles.roleChoiceTextWrap}>
                <Text style={styles.roleChoiceTitle}>Satıcı olarak devam et</Text>
                <Text style={styles.roleChoiceBody}>Satıcı profilini doldurup mutfağını hazırla.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#819376" />
            </TouchableOpacity>
          </View>
        </>
      );
    }

    return (
      <>
        <AuthInput icon="mail-outline" label={t('helper.login.emailLabel')} value={email} onChangeText={(v) => { setEmail(v); clearError(); }} placeholder={t('helper.login.emailPlaceholder')} keyboardType="email-address" />
        <PasswordInput label={t('helper.login.passwordLabel')} value={password} onChangeText={(v) => { setPassword(v); clearError(); }} show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
        <TouchableOpacity style={styles.forgotLink} onPress={() => setStep('forgot')} activeOpacity={0.75}>
          <Text style={styles.forgotText}>{t('cta.login.forgotPassword')}</Text>
        </TouchableOpacity>
        <PrimaryButton label={t('cta.login.signIn')} loading={loading} onPress={() => loginWithCredentials(email, password)} />
        <InlineLink text={t('helper.login.noAccount')} actionText={t('cta.login.register')} onPress={openSignUp} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF7EC" />
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.8}
            onPress={() => {
              if (step === 'signIn') return;
              setStep(step === 'newPassword' ? 'resetSent' : step === 'roleChoice' ? 'otp' : 'signIn');
              setError(null);
            }}
          >
            {step !== 'signIn' ? <Ionicons name="chevron-back" size={20} color="#3D3229" /> : null}
          </TouchableOpacity>

          <View style={styles.header}>
            <Image source={require('../../assets/images/coziyoo-wordmark-color-transparent.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>{title}</Text>
            {step === 'signIn' ? <Text style={styles.subtitle}>{t('headline.login.subtitle')}</Text> : null}
          </View>

          <View style={styles.formCard}>
            {renderContent()}
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>

          <QuickLoginPanel loading={loading} onQuickLogin={handleQuickLogin} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthInput(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  maxLength?: number;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name={props.icon} size={18} color="#819376" />
        <TextInput
          style={styles.input}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor="#B8AA9B"
          keyboardType={props.keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={props.maxLength}
        />
        {props.value ? <Ionicons name="checkmark-outline" size={18} color="#819376" /> : null}
      </View>
    </View>
  );
}

function PasswordInput(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  show: boolean;
  onToggle?: () => void;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name="lock-closed-outline" size={18} color="#819376" />
        <TextInput
          style={styles.input}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={t('helper.login.passwordPlaceholder')}
          placeholderTextColor="#B8AA9B"
          secureTextEntry={!props.show}
          autoCapitalize="none"
        />
        {props.onToggle ? (
          <TouchableOpacity onPress={props.onToggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={props.show ? 'eye-off-outline' : 'eye-outline'} size={19} color="#9B8D7D" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function PrimaryButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.primaryButton, loading && styles.disabled]} onPress={onPress} disabled={loading} activeOpacity={0.88}>
      {loading ? <ActivityIndicator color="#FFFDF9" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function InlineLink({ text, actionText, onPress }: { text: string; actionText: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.inlineLink} onPress={onPress} activeOpacity={0.72}>
      <Text style={styles.inlineLinkText}>
        {text ? `${text} ` : ''}
        <Text style={styles.inlineLinkAction}>{actionText}</Text>
      </Text>
    </TouchableOpacity>
  );
}

function QuickLoginPanel({ loading, onQuickLogin }: { loading: boolean; onQuickLogin: (role: 'buyer' | 'seller') => void }) {
  return (
    <View style={styles.quickPanel}>
      <Text style={styles.quickTitle}>{t('helper.auth.previewLogin')}</Text>
      <View style={styles.quickLoginRow}>
        <TouchableOpacity style={[styles.quickLoginButton, loading && styles.disabled]} onPress={() => onQuickLogin('buyer')} disabled={loading} activeOpacity={0.86}>
          <Ionicons name="person-outline" size={16} color="#819376" />
          <Text style={styles.quickLoginText}>{t('cta.login.quickBuyerSignIn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickLoginButton, loading && styles.disabled]} onPress={() => onQuickLogin('seller')} disabled={loading} activeOpacity={0.86}>
          <Ionicons name="storefront-outline" size={16} color="#819376" />
          <Text style={styles.quickLoginText}>{t('cta.login.quickSellerSignIn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF7EC' },
  keyboard: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 34,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  header: { alignItems: 'center', marginBottom: 18 },
  logo: { width: 176, height: 37, marginBottom: 14 },
  title: { color: '#3D3229', fontSize: 23, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#7D6B5B', fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  formCard: {
    width: '100%',
    gap: 12,
  },
  screenDesc: { color: '#6B5D4F', fontSize: 13, lineHeight: 20, marginBottom: 2 },
  inputBlock: { gap: 6 },
  label: { color: '#7A6D61', fontSize: 11, fontWeight: '800' },
  inputWrap: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#E8DDD0',
    borderRadius: 25,
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  input: { flex: 1, color: '#3D3229', fontSize: 14, paddingVertical: 12 },
  forgotLink: { alignSelf: 'flex-end', paddingVertical: 2 },
  forgotText: { color: '#819376', fontSize: 12, fontWeight: '700' },
  primaryButton: {
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: '#819376',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#3D3229',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  primaryButtonText: { color: '#FFFDF9', fontSize: 14, fontWeight: '800' },
  inlineLink: { alignItems: 'center', paddingVertical: 8 },
  inlineLinkText: { color: '#8A7D70', fontSize: 13 },
  inlineLinkAction: { color: '#819376', fontWeight: '800' },
  error: { color: theme.error, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  disabled: { opacity: 0.62 },
  centerPanel: { alignItems: 'center', gap: 18, paddingVertical: 24 },
  successRing: {
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 8,
    borderColor: '#819376',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successRefresh: { position: 'absolute', right: -12, top: 14, backgroundColor: '#FFF7EC' },
  successTitle: { color: '#819376', fontSize: 22, lineHeight: 28, fontWeight: '800', textAlign: 'center' },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 10 },
  otpCell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EDE8E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpCellFilled: { backgroundColor: '#DDE7D8' },
  otpText: { color: '#3D3229', fontSize: 18, fontWeight: '800' },
  roleChoiceStack: { gap: 12 },
  roleChoiceButton: {
    minHeight: 82,
    borderWidth: 1,
    borderColor: '#E1EADB',
    borderRadius: 24,
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roleChoiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F7EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleChoiceTextWrap: { flex: 1, minWidth: 0 },
  roleChoiceTitle: { color: '#3D3229', fontSize: 15, fontWeight: '800' },
  roleChoiceBody: { color: '#7D6B5B', fontSize: 12, lineHeight: 17, marginTop: 3 },
  hiddenOtpInput: { height: 0, width: 0, opacity: 0 },
  resendText: { color: '#7D6B5B', fontSize: 12, textAlign: 'center', marginBottom: 4 },
  quickPanel: { marginTop: 22, gap: 8 },
  quickTitle: { color: '#8A7D70', fontSize: 12, textAlign: 'center', fontWeight: '700' },
  quickLoginRow: { flexDirection: 'row', gap: 10 },
  quickLoginButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#DDE7D8',
    borderRadius: 22,
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  quickLoginText: { color: '#819376', fontSize: 12, fontWeight: '800' },
});
