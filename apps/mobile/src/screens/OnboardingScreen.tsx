import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
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
  const [isHovered, setIsHovered] = useState(false);

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
          <Pressable
            style={({ pressed }) => [
              styles.getStartedBtn,
              isHovered && styles.getStartedBtnHover,
              pressed && styles.getStartedBtnPressed,
            ]}
            onPress={onGoToLogin}
            onHoverIn={() => setIsHovered(true)}
            onHoverOut={() => setIsHovered(false)}
          >
            <Text style={styles.getStartedText}>Get Started</Text>
          </Pressable>
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
    width: 350,
    height: 98,
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
    borderWidth: 2,
    borderColor: '#6B876F',
    shadowColor: '#1E271D',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  getStartedBtnHover: {
    backgroundColor: '#F7F7F6',
    borderColor: '#5D7A61',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
  },
  getStartedBtnPressed: {
    transform: [{ translateY: 1 }],
    borderColor: '#B45C37',
    backgroundColor: '#ECEFEA',
    shadowOpacity: 0.2,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
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
