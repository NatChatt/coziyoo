import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  Animated,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  type ImageSourcePropType,
} from 'react-native';
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
  illustration: 'logo' | 'chef' | 'ai' | 'community';
  image?: ImageSourcePropType;
};

const ONBOARDING_IMAGES = {
  near: require('../../assets/images/onboarding-near.png'),
  ai: require('../../assets/images/onboarding-ai.png'),
  choice: require('../../assets/images/onboarding-choice.png'),
} as const;

function getSlides(): OnboardingSlide[] {
  return [
    {
      key: 'brand',
      title: t('headline.onboarding.brandTitle'),
      body: t('helper.onboarding.brandSubtitle'),
      illustration: 'logo',
    },
    {
      key: 'near',
      title: t('headline.onboarding.nearTitle'),
      body: t('helper.onboarding.nearSubtitle'),
      illustration: 'chef',
      image: ONBOARDING_IMAGES.near,
    },
    {
      key: 'ai',
      title: t('headline.onboarding.aiTitle'),
      body: t('helper.onboarding.aiSubtitle'),
      illustration: 'ai',
      image: ONBOARDING_IMAGES.ai,
    },
    {
      key: 'choice',
      title: t('headline.onboarding.choiceTitle'),
      body: t('helper.onboarding.choiceSubtitle'),
      illustration: 'community',
      image: ONBOARDING_IMAGES.choice,
    },
  ];
}

export default function OnboardingScreen({ onGoToLogin }: Props) {
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const logoIntro = useRef(new Animated.Value(0)).current;
  const textIntro = useRef(new Animated.Value(0)).current;
  const slides = getSlides();
  const slide = slides[index] ?? slides[0];
  const isBrand = slide.illustration === 'logo';

  const screenStyle = useMemo(
    () => [styles.screen, isBrand ? styles.brandScreen : styles.lightScreen],
    [isBrand],
  );

  useEffect(() => {
    if (!isBrand) return;
    logoIntro.setValue(0);
    textIntro.setValue(0);
    Animated.parallel([
      Animated.timing(logoIntro, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(1180),
        Animated.timing(textIntro, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [isBrand, logoIntro, textIntro]);

  const brandTextAnimatedStyle = isBrand
    ? {
        opacity: textIntro,
        transform: [
          {
            scale: textIntro.interpolate({
              inputRange: [0, 1],
              outputRange: [0.88, 1],
            }),
          },
          {
            translateY: textIntro.interpolate({
              inputRange: [0, 1],
              outputRange: [18, 0],
            }),
          },
        ],
      }
    : null;

  function goNext() {
    if (index >= slides.length - 1) {
      onGoToLogin();
      return;
    }
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setIndex((value) => Math.min(value + 1, slides.length - 1));
  }

  return (
    <SafeAreaView style={[styles.safe, isBrand ? styles.brandSafe : styles.lightSafe]}>
      <StatusBar barStyle={isBrand ? 'light-content' : 'dark-content'} backgroundColor={isBrand ? '#819376' : '#FFF7EC'} />
      <View style={screenStyle}>
        <Animated.View style={[styles.topArea, { opacity: fade }]}>
          <Illustration slide={slide} logoIntro={logoIntro} />
          <Animated.View style={[styles.copyWrap, brandTextAnimatedStyle]}>
            <Text style={[styles.title, isBrand ? styles.brandTitle : null]}>{slide.title}</Text>
            <Text style={[styles.body, isBrand ? styles.brandBody : null]}>{slide.body}</Text>
          </Animated.View>
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
            {slides.map((item, dotIndex) => (
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

function Illustration({ slide, logoIntro }: { slide: OnboardingSlide; logoIntro: Animated.Value }) {
  if (slide.illustration === 'logo') {
    const logoAnimatedStyle = {
      opacity: logoIntro,
      transform: [
        {
          perspective: 900,
        },
        {
          scale: logoIntro.interpolate({
            inputRange: [0, 0.78, 1],
            outputRange: [0.02, 0.92, 1],
          }),
        },
        {
          rotate: logoIntro.interpolate({
            inputRange: [0, 1],
            outputRange: ['-10deg', '0deg'],
          }),
        },
        {
          translateY: logoIntro.interpolate({
            inputRange: [0, 1],
            outputRange: [170, 0],
          }),
        },
      ],
    };

    return (
      <View style={styles.logoStage}>
        <Animated.Image
          source={require('../../assets/images/coziyoo-wordmark-white-transparent.png')}
          style={[styles.logo, logoAnimatedStyle]}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[styles.illustrationStage, slide.illustration === 'community' ? styles.illustrationStageWide : null]}>
      {slide.image ? (
        <Image source={slide.image} style={styles.illustrationImage} resizeMode="contain" />
      ) : null}
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
  logoStage: { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logo: { width: 248, height: 53 },
  illustrationStage: {
    width: '100%',
    height: 292,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  illustrationStageWide: { height: 230 },
  illustrationImage: { width: '100%', height: '100%' },
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
