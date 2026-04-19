import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { readJsonSafe } from '../utils/http';
import { theme } from '../theme/colors';

type Step = 'welcome' | 'register';

type Props = {
  onComplete: (session: AuthSession) => void;
  onGoToLogin: () => void;
};

type RegisterResponse = {
  data?: {
    user?: { id?: string; email?: string; displayName?: string; userType?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string };
};

export default function OnboardingScreen({ onComplete, onGoToLogin }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [userType, setUserType] = useState<'buyer' | 'seller'>('buyer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  function animateTransition(next: Step) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setStep(next);
      setError(null);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }

  function handleRegisterPress() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) { setError('E-posta adresini gir'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Geçerli bir e-posta gir'); return; }
    if (password.length < 8) { setError('Şifre en az 8 karakter olmalı'); return; }
    if (password !== passwordConfirm) { setError('Şifreler eşleşmiyor'); return; }
    handleRegister();
  }

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          userType,
        }),
      });
      const json = await readJsonSafe<RegisterResponse>(response);

      if (!response.ok || json.error) {
        const code = json.error?.code;
        if (code === 'EMAIL_TAKEN') setError('Bu e-posta zaten kayıtlı');
        else if (code === 'VALIDATION_ERROR') {
          const details = (json.error as Record<string, unknown>)?.details as { fieldErrors?: Record<string, string[]> } | undefined;
          const fields = details?.fieldErrors;
          if (fields?.password?.length) setError('Şifre en az 8 karakter olmalı');
          else if (fields?.email?.length) setError('Geçerli bir e-posta gir');
          else setError('Lütfen bilgileri kontrol et');
        }
        else setError(json.error?.message ?? `Kayıt başarısız (${response.status})`);
        return;
      }

      const { user, tokens } = json.data ?? {};
      if (!tokens?.accessToken || !tokens?.refreshToken || !user?.id) {
        setError('Beklenmeyen sunucu yanıtı');
        return;
      }

      const session: AuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        userType: user.userType ?? 'buyer',
        email: user.email ?? email.trim().toLowerCase(),
      };
      await saveAuthSession(session);
      onComplete(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  function renderWelcome() {
    return (
      <View style={styles.welcomeScreen}>
        <View style={styles.welcomeBrandWrap}>
          <Text style={styles.welcomeBrand}>CoziYoo</Text>
          <Text style={styles.welcomeSubtitle}>Homemade Food Near You</Text>
        </View>

        <View style={styles.welcomeBottomWrap}>
          <TouchableOpacity
            style={styles.getStartedBtn}
            onPress={() => animateTransition('register')}
            activeOpacity={0.85}
          >
            <Text style={styles.getStartedText}>Get Started</Text>
          </TouchableOpacity>
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <TouchableOpacity style={styles.welcomeLoginLink} onPress={onGoToLogin} activeOpacity={0.8}>
            <Text style={styles.welcomeLoginText}>Zaten hesabım var</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderRegister() {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Hesabını oluştur</Text>
        <Text style={styles.stepSubtitle}>E-posta ve şifreni gir</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>E-posta</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="ornek@email.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Hesap tipi</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleBtn, userType === 'buyer' && styles.roleBtnActive]}
              onPress={() => setUserType('buyer')}
              activeOpacity={0.85}
            >
              <Text style={[styles.roleBtnText, userType === 'buyer' && styles.roleBtnTextActive]}>Alıcı</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleBtn, userType === 'seller' && styles.roleBtnActive]}
              onPress={() => setUserType('seller')}
              activeOpacity={0.85}
            >
              <Text style={[styles.roleBtnText, userType === 'seller' && styles.roleBtnTextActive]}>Satıcı</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Şifre</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(v) => { setPassword(v); setError(null); }}
              placeholder="En az 8 karakter"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Şifre Tekrar</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={passwordConfirm}
              onChangeText={(v) => { setPasswordConfirm(v); setError(null); }}
              placeholder="Şifreni tekrar gir"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPasswordConfirm}
              returnKeyType="go"
              onSubmitEditing={handleRegisterPress}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPasswordConfirm(!showPasswordConfirm)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPasswordConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={handleRegisterPress}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Kayıt Ol</Text>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={onGoToLogin} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>Zaten hesabım var? <Text style={styles.loginLink}>Giriş yap</Text></Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showBack = step === 'register';

  const isWelcome = step === 'welcome';

  return (
    <SafeAreaView style={[styles.safe, isWelcome && styles.safeWelcome]}>
      <StatusBar barStyle={isWelcome ? 'light-content' : 'dark-content'} backgroundColor={isWelcome ? '#8F9D86' : theme.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {showBack && (
          <View style={styles.header}>
            <TouchableOpacity onPress={() => animateTransition('welcome')} style={styles.backBtn} activeOpacity={0.7} disabled={loading}>
              <Ionicons name="arrow-back" size={24} color={theme.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
        )}

        <Animated.View style={[styles.body, { opacity: fadeAnim }]}>
          {step === 'welcome' && renderWelcome()}
          {step === 'register' && renderRegister()}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.background },
  safeWelcome: { backgroundColor: '#8F9D86' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  body: { flex: 1, paddingHorizontal: 24 },

  welcomeScreen: {
    flex: 1,
    backgroundColor: '#8F9D86',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 140,
    paddingBottom: 46,
  },
  welcomeBrandWrap: {
    alignItems: 'center',
  },
  welcomeBrand: {
    color: '#F5F5F2',
    fontSize: 76,
    lineHeight: 84,
    fontWeight: '900',
    letterSpacing: -2.2,
  },
  welcomeBottomWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  getStartedBtn: {
    width: '78%',
    backgroundColor: '#F2F2F1',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  getStartedText: {
    color: '#8A9883',
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  welcomeSubtitle: {
    fontSize: 30,
    fontWeight: '500',
    color: '#ECEEE8',
    marginTop: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#F4F5F2',
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: '#F4F5F2',
  },
  welcomeLoginLink: {
    marginTop: 4,
  },
  welcomeLoginText: {
    color: '#F4F5F2',
    fontSize: 13,
    fontWeight: '600',
  },

  stepContent: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: theme.text,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 28,
  },

  inputGroup: { marginBottom: 16 },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    paddingVertical: 12,
    alignItems: 'center',
  },
  roleBtnActive: {
    borderColor: theme.primary,
    backgroundColor: '#EAF4ED',
  },
  roleBtnText: { color: theme.textSecondary, fontWeight: '700' },
  roleBtnTextActive: { color: theme.primary },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 16,
    color: theme.text,
    paddingVertical: 14,
  },

  primaryBtn: {
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 16,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  loginLink: {
    color: theme.primary,
    fontWeight: '700',
  },

  errorText: {
    color: theme.error,
    fontSize: 13,
    marginBottom: 4,
  },
});
