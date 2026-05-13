import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { t } from '../../copy/brandCopy';
import type { MealCard } from '../../types/meal';
import {
  deriveCardColors,
  hexToRgba,
} from '../../utils/color';
import {
  fileSystemCacheDirectory,
  fileSystemEncodingTypeBase64,
  fileSystemGetInfoAsync,
  fileSystemWriteAsStringAsync,
  ManipulatorSaveFormat,
  manipulateAsync,
} from '../../utils/lazyNativeModules';
import {
  formatCuisineLabel,
  formatSellerIdentity,
  hashInlineImageUri,
  inlineImageExtension,
  isInlineBase64ImageUri,
  resolveFoodPhotoTitleMetrics,
} from '../../utils/mealFormat';
import { foodCardStyles as styles } from './styles';

const FOOD_CARD_RENDER_URI_CACHE = new Map<string, string>();

type FoodInfoChipProps = {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  labelColor: string;
};

function FoodInfoChip({
  iconName,
  iconColor,
  label,
  labelColor,
}: FoodInfoChipProps) {
  return (
    <View style={styles.foodInfoChip}>
      <Ionicons name={iconName} size={15} color={iconColor} />
      <Text numberOfLines={1} style={[styles.foodInfoChipText, { color: labelColor }]}>
        {label}
      </Text>
    </View>
  );
}

type FoodCardProps = {
  meal: MealCard;
  isFavorite: boolean;
  favoritePending: boolean;
  onPress: () => void;
  onFavoritePress: () => void;
};

export function FoodCard({
  meal,
  isFavorite,
  favoritePending,
  onPress,
  onFavoritePress,
}: FoodCardProps) {
  const defaultCardImageWidth = Math.max(260, Math.round(Dimensions.get('window').width - 32));
  const colors = deriveCardColors(meal.backgroundColor);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageFrameWidth, setImageFrameWidth] = useState(defaultCardImageWidth);
  const [sellerThumbFailed, setSellerThumbFailed] = useState(false);
  const [renderableImageUri, setRenderableImageUri] = useState<string | null>(null);
  const primaryImageUrl = imageUrls[0];
  const activeImageUrl = imageUrls[imageIndex] ?? primaryImageUrl;

  useEffect(() => {
    const next = [...(meal.imageUrls ?? []), meal.imageUrl ?? '']
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);
    setImageUrls(next);
    setImageIndex(0);
  }, [meal.imageUrl, meal.imageUrls]);

  useEffect(() => {
    setSellerThumbFailed(false);
  }, [meal.sellerImage]);

  useEffect(() => {
    if (!activeImageUrl) {
      setRenderableImageUri(null);
      return;
    }

    if (!isInlineBase64ImageUri(activeImageUrl)) {
      setRenderableImageUri(activeImageUrl);
      return;
    }

    const cachedUri = FOOD_CARD_RENDER_URI_CACHE.get(activeImageUrl);
    if (cachedUri) {
      setRenderableImageUri(cachedUri);
      return;
    }

    let cancelled = false;
    setRenderableImageUri(null);

    const materializeInlineImage = async () => {
      try {
        const commaIndex = activeImageUrl.indexOf(',');
        if (commaIndex <= 0) {
          setRenderableImageUri(activeImageUrl);
          return;
        }
        const base64Payload = activeImageUrl.slice(commaIndex + 1);
        if (
          fileSystemCacheDirectory &&
          fileSystemWriteAsStringAsync &&
          fileSystemGetInfoAsync &&
          fileSystemEncodingTypeBase64
        ) {
          const extension = inlineImageExtension(activeImageUrl);
          const fileUri = `${fileSystemCacheDirectory}food-card-${hashInlineImageUri(activeImageUrl)}.${extension}`;
          const info = await fileSystemGetInfoAsync(fileUri);
          if (!info.exists) {
            await fileSystemWriteAsStringAsync(fileUri, base64Payload, {
              encoding: fileSystemEncodingTypeBase64,
            });
          }
          if (cancelled) return;
          FOOD_CARD_RENDER_URI_CACHE.set(activeImageUrl, fileUri);
          setRenderableImageUri(fileUri);
          return;
        }

        if (manipulateAsync && ManipulatorSaveFormat) {
          const format = activeImageUrl.startsWith('data:image/png')
            ? ManipulatorSaveFormat.PNG
            : ManipulatorSaveFormat.JPEG;
          const result = await manipulateAsync(
            activeImageUrl,
            [],
            { compress: 1, format, base64: false },
          );
          if (cancelled || !result?.uri) return;
          FOOD_CARD_RENDER_URI_CACHE.set(activeImageUrl, result.uri);
          setRenderableImageUri(result.uri);
          return;
        }

        setRenderableImageUri(activeImageUrl);
      } catch {
        if (!cancelled) {
          setRenderableImageUri(null);
        }
      }
    };

    void materializeInlineImage();
    return () => {
      cancelled = true;
    };
  }, [activeImageUrl]);

  const allergens = Array.isArray(meal.allergens) ? meal.allergens : [];
  const mealDeliveryOptions = meal.deliveryOptions ?? { pickup: true, delivery: false };
  const stockSummary = Number.isFinite(meal.stock) && meal.stock > 0
    ? t('status.home.foodCard.lastPortions').replace('{stock}', String(meal.stock))
    : '';
  const hasAllergens = allergens.length > 0;
  const titleMetrics = resolveFoodPhotoTitleMetrics(meal.title);
  const sellerHandle = formatSellerIdentity(meal.seller, meal.sellerUsername);
  const sellerTagline = String(meal.sellerTagline ?? '').trim() || t('status.home.foodCard.sellerTaglineFallback');
  const ratingValue = Number(String(meal.rating ?? '').replace(',', '.'));
  const ratingBadgeText = Number.isFinite(ratingValue) ? Number(ratingValue).toFixed(1) : '0.0';
  const slideWidth = Math.max(1, imageFrameWidth);
  const compactStockSummary = (stockSummary || t('status.home.foodCard.preparingToday'))
    .replace(/^Son\s+/i, '')
    .replace(/\s+porsiyon$/i, ' pors.');
  const compactDistanceText = (() => {
    const raw = mealDeliveryOptions.delivery && String(meal.distance ?? '').trim()
      ? String(meal.distance).trim()
      : '';
    if (!raw) return '';
    const numeric = Number(raw.replace(',', '.').replace(/\s*km$/i, ''));
    if (Number.isFinite(numeric)) {
      return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)} km`;
    }
    return raw.replace(/\s+/g, ' ');
  })();
  const sellerInitial = (() => {
    const raw = (meal.sellerUsername || meal.seller || 'U').replace(/^@+/, '').trim();
    if (!raw) return 'U';
    return raw.charAt(0).toLocaleUpperCase('tr-TR');
  })();

  return (
    <View style={styles.foodCardWrap}>
      <View style={[styles.foodCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <View
          style={[styles.foodPhoto, { backgroundColor: meal.backgroundColor }]}
          onLayout={(event) => {
            const nextWidth = Math.max(220, Math.round(event.nativeEvent.layout.width));
            setImageFrameWidth((prev) => (prev === nextWidth ? prev : nextWidth));
          }}
        >
          {imageUrls.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              style={styles.foodImageCarousel}
              contentContainerStyle={styles.foodImageCarouselContent}
              onMomentumScrollEnd={(event) => {
                const width = Math.max(1, event.nativeEvent.layoutMeasurement.width);
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                const safeIndex = Math.max(0, Math.min(nextIndex, imageUrls.length - 1));
                setImageIndex(safeIndex);
              }}
            >
              {imageUrls.map((uri, idx) => {
                const sourceUri = idx === imageIndex ? (renderableImageUri || uri) : uri;
                return (
                  <View key={`${uri}-${idx}`} style={[styles.foodImageSlide, { width: slideWidth }]}>
                    <Image
                      source={{ uri: sourceUri }}
                      style={styles.foodImage}
                      resizeMode="cover"
                      onError={() => {
                        if (idx === imageIndex && isInlineBase64ImageUri(uri)) {
                          setRenderableImageUri(null);
                        }
                      }}
                    />
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.foodImageFallback} />
          )}
          {imageUrls.length > 1 ? (
            <View pointerEvents="none" style={styles.foodPhotoDotsRow}>
              {imageUrls.map((_, idx) => (
                <View
                  key={`dot-${idx}`}
                  style={[styles.foodPhotoDot, idx === imageIndex && styles.foodPhotoDotActive]}
                />
              ))}
            </View>
          ) : null}
          <View pointerEvents="none" style={styles.foodPhotoTitleOverlay}>
            <Text numberOfLines={2} style={[styles.foodPhotoTitleText, titleMetrics]}>
              {meal.title}
            </Text>
            {meal.cuisine ? (
              <Text numberOfLines={1} style={styles.foodPhotoCuisineText}>
                {formatCuisineLabel(meal.cuisine)}
              </Text>
            ) : null}
          </View>
          <View style={styles.foodBadgesRight}>
            <View style={[styles.foodPriceBadge, { backgroundColor: hexToRgba(colors.price, 0.92) }]}>
              <Text style={styles.foodPriceBadgeText}>{meal.price}</Text>
            </View>
            <View style={[styles.foodRatingBadge, { backgroundColor: hexToRgba(colors.price, 0.92) }]}>
              <Ionicons name="star" size={14} color="#F2B23A" />
              <Text style={styles.foodRatingBadgeText}>{ratingBadgeText}</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={(event) => {
              event.stopPropagation();
              onFavoritePress();
            }}
            style={[styles.foodPhotoFavoriteBtn, isFavorite && styles.foodFooterFavoriteBtnActive]}
            disabled={favoritePending}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color={isFavorite ? '#FFF4F1' : '#FFFDFB'}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.96}
          onPress={onPress}
          style={[
            styles.foodInfo,
            { backgroundColor: colors.bg, borderTopColor: hexToRgba(colors.border, 0.62) },
          ]}
        >
          <View style={styles.foodInfoContent}>
            <View style={styles.foodInfoChipRow}>
              <FoodInfoChip
                iconName="restaurant-outline"
                iconColor={colors.price}
                label={compactStockSummary}
                labelColor={colors.title}
              />
              <FoodInfoChip
                iconName="time-outline"
                iconColor={colors.price}
                label={meal.time || t('status.home.foodCard.timeSoon')}
                labelColor={colors.title}
              />
              {compactDistanceText ? (
                <FoodInfoChip
                  iconName="location-outline"
                  iconColor={colors.price}
                  label={compactDistanceText}
                  labelColor={colors.title}
                />
              ) : null}
              <FoodInfoChip
                iconName={hasAllergens ? 'warning-outline' : 'checkmark-circle-outline'}
                iconColor={hasAllergens ? '#B13B2E' : '#2F6F4A'}
                label={hasAllergens ? t('status.home.foodCard.hasAllergens') : t('status.home.foodCard.noAllergens')}
                labelColor={hasAllergens ? '#9D3026' : '#2F6F4A'}
              />
            </View>
            <View style={[styles.foodFooterRow, { borderTopColor: hexToRgba(colors.border, 0.4) }]}>
              <View style={styles.foodFooterSeller}>
                <View style={styles.foodSellerThumbWrap}>
                  <View style={styles.foodSellerThumb}>
                    {meal.sellerImage && !sellerThumbFailed ? (
                      <Image
                        source={{ uri: meal.sellerImage }}
                        style={styles.foodSellerThumbImage}
                        onError={() => setSellerThumbFailed(true)}
                      />
                    ) : (
                      <View style={styles.foodSellerThumbFallback}>
                        <Text style={[styles.foodSellerThumbFallbackText, { color: colors.price }]}>
                          {sellerInitial}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.foodFooterSellerText}>
                  <Text style={[styles.foodFooterSellerHandle, { color: colors.price }]}>
                    {sellerHandle}
                  </Text>
                  <Text style={[styles.foodFooterSellerTagline, { color: colors.subtitle }]}>
                    {sellerTagline}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}
