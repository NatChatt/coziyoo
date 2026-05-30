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
  offsetXRatio?: number | null;
  offsetYRatio?: number | null;
  focalX: number;
  focalY: number;
  gradientOpacity: number;
  overlayColor: string | null;
  devicePreviewMode: string | null;
  topFadeOpacity: number;
  safeAreaTop: number;
  textSafeAreaTop: number;
  bottomSafeArea: number;
  textLayers?: HomeHeroTextLayer[];
};

export type HomeHeroTextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontFamily?: string | null;
  fontSize: number;
  fontWeight?: '400' | '500' | '600' | '700' | '800' | '900' | 'normal' | 'bold' | null;
  color: string;
  opacity?: number | null;
  rotation?: number | null;
  align?: 'left' | 'center' | 'right' | null;
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

  const effectiveOffsetX = useMemo(() => {
    if (typeof config.offsetXRatio === 'number' && Number.isFinite(config.offsetXRatio) && !isTabletLayout) {
      return config.offsetXRatio * contentWidth;
    }
    return config.offsetX;
  }, [config.offsetX, config.offsetXRatio, contentWidth, isTabletLayout]);

  const effectiveOffsetY = useMemo(() => {
    if (typeof config.offsetYRatio === 'number' && Number.isFinite(config.offsetYRatio) && !isTabletLayout) {
      return config.offsetYRatio * visibleHeight;
    }
    return config.offsetY;
  }, [config.offsetY, config.offsetYRatio, isTabletLayout, visibleHeight]);

  const imageStyle = useMemo(
    () => [
      styles.heroImageInner,
      {
        transform: [
          { translateX: effectiveOffsetX },
          { translateY: effectiveOffsetY },
          { scale: config.scale },
        ],
      },
    ],
    [effectiveOffsetX, effectiveOffsetY, config.scale],
  );
  const textLayers = Array.isArray(config.textLayers) ? config.textLayers.filter((layer) => layer.text.trim()) : [];

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
                  toRgba(baseBackgroundColor, 0.08),
                  toRgba(baseBackgroundColor, 0.46 * config.gradientOpacity),
                  toRgba(baseBackgroundColor, 0.82 * config.gradientOpacity),
                  toRgba(baseBackgroundColor, 0.96 * config.gradientOpacity),
                  baseBackgroundColor,
                  baseBackgroundColor,
                ]
              : [
                  toRgba(baseBackgroundColor, 0),
                  toRgba(baseBackgroundColor, 0.18 * config.gradientOpacity),
                  toRgba(baseBackgroundColor, 0.5 * config.gradientOpacity),
                  toRgba(baseBackgroundColor, 0.82 * config.gradientOpacity),
                  baseBackgroundColor,
                ]
          }
          locations={isTabletLayout ? [0, 0.08, 0.16, 0.24, 0.34, 1] : [0, 0.22, 0.52, 0.78, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[
            styles.bottomFade,
            isTabletLayout ? { bottom: -230, height: 390 } : { bottom: 0, height: 96 },
          ]}
        />
      ) : null}
      {textLayers.length > 0 ? (
        <View pointerEvents="none" style={styles.textLayerHost}>
          {textLayers.map((layer) => (
            <Text
              key={layer.id}
              style={[
                styles.customTextLayer,
                {
                  left: `${Math.max(0, Math.min(1, layer.x)) * 100}%`,
                  top: `${Math.max(0, Math.min(1, layer.y)) * 100}%`,
                  color: layer.color || '#23170F',
                  fontSize: Math.max(8, Math.min(72, layer.fontSize || 24)),
                  fontWeight: layer.fontWeight || '700',
                  opacity: layer.opacity == null ? 1 : Math.max(0, Math.min(1, layer.opacity)),
                  textAlign: layer.align || 'left',
                  transform: [{ rotate: `${layer.rotation || 0}deg` }],
                },
                layer.fontFamily ? { fontFamily: layer.fontFamily } : null,
              ]}
            >
              {layer.text}
            </Text>
          ))}
        </View>
      ) : (
        <View style={[styles.textArea, { paddingTop: config.textSafeAreaTop }, isTabletLayout && styles.textAreaTablet]}>
          <Text style={[styles.question, isTabletLayout && styles.questionTablet]}>{questionText}</Text>
          <View style={styles.markerRow}>
            <Text style={styles.markerIcon}>↝</Text>
            <View style={styles.markerLine} />
          </View>
        </View>
      )}
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
    overflow: 'hidden',
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
    resizeMode: 'contain',
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
  textLayerHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
  customTextLayer: {
    position: 'absolute',
    maxWidth: '78%',
    lineHeight: undefined,
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
