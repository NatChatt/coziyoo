import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  Animated,
  StyleSheet,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AuthSession } from '../utils/auth';
import { t } from '../copy/brandCopy';

type Props = {
  onComplete: (session: AuthSession) => void;
  onGoToLogin: () => void;
};

type OnboardingSlide = {
  key: string;
  title: string;
  body: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  illustration: 'logo' | 'chef' | 'ai' | 'community';
};

const SLIDES: OnboardingSlide[] = [
  {
    key: 'brand',
    title: t('headline.onboarding.brandTitle'),
    body: t('helper.onboarding.brandSubtitle'),
    icon: 'restaurant-outline',
    illustration: 'logo',
  },
  {
    key: 'near',
    title: t('headline.onboarding.nearTitle'),
    body: t('helper.onboarding.nearSubtitle'),
    icon: 'home-outline',
    illustration: 'chef',
  },
  {
    key: 'ai',
    title: t('headline.onboarding.aiTitle'),
    body: t('helper.onboarding.aiSubtitle'),
    icon: 'sparkles-outline',
    illustration: 'ai',
  },
  {
    key: 'choice',
    title: t('headline.onboarding.choiceTitle'),
    body: t('helper.onboarding.choiceSubtitle'),
    icon: 'people-outline',
    illustration: 'community',
  },
];

export default function OnboardingScreen({ onGoToLogin }: Props) {
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const slide = SLIDES[index];
  const isBrand = slide.illustration === 'logo';

  const screenStyle = useMemo(
    () => [styles.screen, isBrand ? styles.brandScreen : styles.lightScreen],
    [isBrand],
  );

  function goNext() {
    if (index >= SLIDES.length - 1) {
      onGoToLogin();
      return;
    }
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setIndex((value) => Math.min(value + 1, SLIDES.length - 1));
  }

  return (
    <SafeAreaView style={[styles.safe, isBrand ? styles.brandSafe : styles.lightSafe]}>
      <StatusBar barStyle={isBrand ? 'light-content' : 'dark-content'} backgroundColor={isBrand ? '#819376' : '#FFF7EC'} />
      <View style={screenStyle}>
        <Animated.View style={[styles.topArea, { opacity: fade }]}>
          <Illustration slide={slide} />
          <View style={styles.copyWrap}>
            <Text style={[styles.title, isBrand ? styles.brandTitle : null]}>{slide.title}</Text>
            <Text style={[styles.body, isBrand ? styles.brandBody : null]}>{slide.body}</Text>
          </View>
        </Animated.View>

        <View style={styles.bottomWrap}>
          <Pressable
            style={({ pressed }) => [
              styles.getStartedBtn,
              !isBrand && styles.getStartedBtnGreen,
              pressed && styles.getStartedBtnPressed,
            ]}
            onPress={goNext}
          >
            <Text style={[styles.getStartedText, !isBrand && styles.getStartedTextLight]}>
              {t('cta.onboarding.getStarted')}
            </Text>
          </Pressable>
          <View style={styles.dotsRow}>
            {SLIDES.map((item, dotIndex) => (
              <View
                key={item.key}
                style={[
                  styles.dot,
                  isBrand ? styles.dotBrand : styles.dotLight,
                  dotIndex === index && (isBrand ? styles.dotBrandActive : styles.dotLightActive),
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Illustration({ slide }: { slide: OnboardingSlide }) {
  if (slide.illustration === 'logo') {
    return (
      <View style={styles.logoStage}>
        <Image
          source={require('../../assets/images/coziyoo-onboarding-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
    );
  }

  const accent = slide.illustration === 'ai' ? '#B15735' : '#819376';
  const secondary = slide.illustration === 'community' ? '#C4953A' : '#EAD9BE';

  return (
    <View style={styles.illustrationStage}>
      <View style={[styles.blob, { backgroundColor: secondary }]} />
      <View style={styles.illustrationCard}>
        <View style={[styles.iconCircle, { backgroundColor: accent }]}>
          <Ionicons name={slide.icon} size={34} color="#FFFDF9" />
        </View>
        <View style={styles.sceneRow}>
          <View style={[styles.person, styles.personTall]} />
          <View style={styles.table}>
            <View style={styles.plate} />
            <View style={styles.bowl} />
          </View>
          <View style={[styles.person, styles.personSmall]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  brandSafe: { backgroundColor: '#819376' },
  lightSafe: { backgroundColor: '#FFF7EC' },
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 76,
    paddingBottom: 50,
  },
  brandScreen: { backgroundColor: '#819376' },
  lightScreen: { backgroundColor: '#FFF7EC' },
  topArea: { width: '100%', alignItems: 'center', flex: 1, justifyContent: 'center' },
  logoStage: { alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logo: { width: 330, height: 120 },
  illustrationStage: {
    width: '100%',
    height: 275,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  blob: {
    position: 'absolute',
    width: 220,
    height: 160,
    borderRadius: 80,
    opacity: 0.26,
    transform: [{ rotate: '-8deg' }],
  },
  illustrationCard: {
    width: 242,
    height: 190,
    borderRadius: 28,
    backgroundColor: '#FFFDF9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EFE3D4',
    shadowColor: '#3D3229',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  sceneRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  person: { width: 26, borderRadius: 13, backgroundColor: '#B15735' },
  personTall: { height: 58 },
  personSmall: { height: 44, backgroundColor: '#819376' },
  table: {
    width: 76,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F4E3C7',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  plate: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFDF9', borderWidth: 4, borderColor: '#C4953A' },
  bowl: { width: 22, height: 16, borderRadius: 9, backgroundColor: '#819376' },
  copyWrap: { alignItems: 'center', paddingHorizontal: 8 },
  title: { color: '#B15735', fontSize: 25, lineHeight: 31, fontWeight: '800', textAlign: 'center' },
  brandTitle: { color: '#FFFDF9', fontSize: 18, marginTop: 4 },
  body: { color: '#6B5D4F', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  brandBody: { color: '#EEF0EA', fontSize: 15, marginTop: 8 },
  bottomWrap: { width: '100%', alignItems: 'center', gap: 18 },
  getStartedBtn: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFDF9',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#1E271D',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  getStartedBtnGreen: { backgroundColor: '#819376' },
  getStartedBtnPressed: { transform: [{ translateY: 1 }], opacity: 0.92 },
  getStartedText: { color: '#819376', fontSize: 16, fontWeight: '800' },
  getStartedTextLight: { color: '#FFFDF9' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotBrand: { backgroundColor: 'rgba(255,255,255,0.45)' },
  dotBrandActive: { backgroundColor: '#FFFDF9', width: 9, height: 9, borderRadius: 5 },
  dotLight: { borderWidth: 1, borderColor: '#B15735', backgroundColor: 'transparent' },
  dotLightActive: { backgroundColor: '#B15735' },
});
