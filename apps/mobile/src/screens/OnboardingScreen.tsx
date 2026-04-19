import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import type { AuthSession } from '../utils/auth';

type Props = {
  onComplete: (session: AuthSession) => void;
  onGoToLogin: () => void;
};

export default function OnboardingScreen({ onGoToLogin }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#8D9C86" />
      <View style={styles.welcomeScreen}>
        <View style={styles.welcomeBrandWrap}>
          <Image
            source={require('../../assets/images/coziyoo-onboarding-logo.png')}
            style={styles.welcomeLogo}
            resizeMode="contain"
          />
          <Text style={styles.welcomeSubtitle}>Homemade Food Near You</Text>
        </View>

        <View style={styles.welcomeBottomWrap}>
          <TouchableOpacity
            style={styles.getStartedBtn}
            onPress={onGoToLogin}
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
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#8D9C86' },
  welcomeScreen: {
    flex: 1,
    backgroundColor: '#8D9C86',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 210,
    paddingBottom: 96,
  },
  welcomeBrandWrap: {
    alignItems: 'center',
  },
  welcomeLogo: {
    width: 306,
    height: 68,
  },
  welcomeSubtitle: {
    fontSize: 17,
    fontWeight: '400',
    color: '#EEF0EA',
    marginTop: 16,
  },
  welcomeBottomWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 20,
  },
  getStartedBtn: {
    width: 316,
    backgroundColor: '#F2F2F1',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  getStartedText: {
    color: '#7F9178',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#F4F5F2',
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: '#F4F5F2',
  },
});
