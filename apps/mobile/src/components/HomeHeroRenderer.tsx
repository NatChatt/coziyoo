import React, { useMemo } from 'react';
import {
  ImageBackground,
  Platform,
  StyleSheet,
  Text,
  View,
  type ImageURISource,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { toRgba } from '../utils/color';

export type HomeHeroRenderConfig = {
  scale: number;
  offsetX: number;
  offsetY: number;
  focalX: number;
  focalY: number;
  gradientOpacity: number;
  overlayColor: string | null;
  devicePreviewMode: string | null;
  topFadeOpacity: number;
  safeAreaTop: number;
  textSafeAreaTop: number;
  bottomSafeArea: number;
};

type LinearGradientComponent = React.ComponentType<{
  colors: string[];
  locations?: number[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: any;
  children?: React.ReactNode;
}> | null;

type Props = {
  imageSource: ImageSourcePropType | null;
  defaultSource?: number | ImageURISource;
  config: HomeHeroRenderConfig;
  visibleHeight: number;
  contentWidth: number;
  isTabletLayout: boolean;
  topBandColor: string;
  bottomBandColor: string;
  baseBackgroundColor: string;
  questionText: string;
  style?: StyleProp<ViewStyle>;
  LinearGradientComponent?: LinearGradientComponent;
  onImageError?: () => void;
};

const HOME_HERO_VISIBLE_HEIGHT = 300;
const HOME_HERO_BASE_WIDTH = 390;
const HOME_HERO_HORIZONTAL_BLEED = 24;
const HOME_HERO_TOP_BLEED = 30;
const HOME_HERO_BOTTOM_BLEED = 56;
const HOME_HERO_BASE_EXTENDED_WIDTH = HOME_HERO_BASE_WIDTH + HOME_HERO_HORIZONTAL_BLEED * 2;
const HOME_HERO_BASE_EXTENDED_HEIGHT =
  HOME_HERO_VISIBLE_HEIGHT + HOME_HERO_TOP_BLEED + HOME_HERO_BOTTOM_BLEED;
const HOME_HERO_BASE_EXTENDED_ASPECT =
  HOME_HERO_BASE_EXTENDED_WIDTH / HOME_HERO_BASE_EXTENDED_HEIGHT;

export function HomeHeroRenderer({
  imageSource,
  defaultSource,
  config,
  visibleHeight,
  contentWidth,
  isTabletLayout,
  topBandColor,
  bottomBandColor,
  baseBackgroundColor,
  questionText,
  style,
  LinearGradientComponent,
  onImageError,
}: Props) {
  const imageFrame = useMemo(() => {
    if (isTabletLayout) {
      return {
        top: -config.safeAreaTop,
        bottom: -config.bottomSafeArea,
      };
    }
    const extendedWidth = contentWidth + HOME_HERO_HORIZONTAL_BLEED * 2;
    const targetHeight = Math.max(
      visibleHeight + config.safeAreaTop + config.bottomSafeArea,
      extendedWidth / HOME_HERO_BASE_EXTENDED_ASPECT,
    );
    const bleedScale = targetHeight / HOME_HERO_BASE_EXTENDED_HEIGHT;
    const topBleed = Math.round(config.safeAreaTop * bleedScale);
    const bottomBleed = Math.round(targetHeight - visibleHeight - topBleed);
    return {
      top: -topBleed,
      bottom: -bottomBleed,
    };
  }, [config.bottomSafeArea, config.safeAreaTop, contentWidth, isTabletLayout, visibleHeight]);

  const imageStyle = useMemo(
    () => [
      styles.heroImageInner,
      {
        transform: [
          { translateX: config.offsetX },
          { translateY: config.offsetY },
          { scale: config.scale },
        ],
      },
    ],
    [config.offsetX, config.offsetY, config.scale],
  );

  return (
    <View
      style={[
        styles.heroWrap,
        {
          height: visibleHeight,
          marginTop: -30,
          paddingTop: 20,
          backgroundColor: topBandColor,
        },
        style,
      ]}
    >
      {imageSource ? (
        <ImageBackground
          source={imageSource}
          defaultSource={defaultSource}
          style={[
            styles.heroImage,
            styles.heroImageExtended,
            imageFrame,
            isTabletLayout && { left: -54, right: -Math.round(contentWidth * 0.28) + 30 },
            isTabletLayout && { transform: [{ translateY: -70 }] },
          ]}
          imageStyle={imageStyle}
          onError={onImageError}
        />
      ) : null}
      {LinearGradientComponent ? (
        <LinearGradientComponent
          colors={[
            toRgba(topBandColor, 0.34 * config.topFadeOpacity),
            toRgba(topBandColor, 0.18 * config.topFadeOpacity),
            toRgba(topBandColor, 0.08 * config.topFadeOpacity),
            toRgba(topBandColor, 0),
          ]}
          locations={[0, 0.42, 0.74, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.topFade}
        />
      ) : null}
      {LinearGradientComponent ? (
        <LinearGradientComponent
          colors={
            isTabletLayout
              ? [
                  toRgba(bottomBandColor, 0.08),
                  toRgba(bottomBandColor, 0.46 * config.gradientOpacity),
                  toRgba(bottomBandColor, 0.82 * config.gradientOpacity),
                  toRgba(bottomBandColor, 0.96 * config.gradientOpacity),
                  baseBackgroundColor,
                  baseBackgroundColor,
                ]
              : [
                  toRgba(bottomBandColor, 0),
                  toRgba(bottomBandColor, 0.22 * config.gradientOpacity),
                  toRgba(bottomBandColor, 0.44 * config.gradientOpacity),
                  toRgba(bottomBandColor, 0.66 * config.gradientOpacity),
                  toRgba(bottomBandColor, 0.86 * config.gradientOpacity),
                  baseBackgroundColor,
                  baseBackgroundColor,
                ]
          }
          locations={isTabletLayout ? [0, 0.08, 0.16, 0.24, 0.34, 1] : [0, 0.12, 0.24, 0.36, 0.48, 0.6, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[
            styles.bottomFade,
            isTabletLayout ? { bottom: -230, height: 390 } : { bottom: -150, height: 220 },
          ]}
        />
      ) : null}
      <View style={[styles.textArea, { paddingTop: config.textSafeAreaTop }, isTabletLayout && styles.textAreaTablet]}>
        <Text style={[styles.question, isTabletLayout && styles.questionTablet]}>{questionText}</Text>
        <View style={styles.markerRow}>
          <Text style={styles.markerIcon}>↝</Text>
          <View style={styles.markerLine} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    position: 'relative',
    minHeight: 220,
    paddingHorizontal: 20,
    paddingTop: 9,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImageExtended: {
    left: -24,
    right: -24,
    top: -30,
    bottom: -56,
  },
  heroImageContained: {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  heroImageInner: {
    resizeMode: 'cover',
  },
  topFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -26,
    height: 190,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -96,
    height: 206,
  },
  textArea: {
    zIndex: 3,
    width: '64%',
    paddingTop: 62,
    paddingBottom: 12,
    paddingLeft: 0,
  },
  textAreaTablet: {
    paddingTop: 96,
    width: '58%',
  },
  question: {
    color: '#23170F',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  questionTablet: {
    fontSize: 24,
    lineHeight: 30,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  markerIcon: {
    color: '#7D5A45',
    fontSize: 13,
    lineHeight: 13,
    marginTop: -1,
  },
  markerLine: {
    width: 42,
    height: 1.6,
    borderRadius: 2,
    backgroundColor: '#A4714E',
  },
});
