import React, { useState } from 'react';
import { View, Text, ScrollView, Image, StyleSheet, StatusBar, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';
import StarRating from '../components/StarRating';
import SectionDivider from '../components/SectionDivider';
import { t } from '../copy/brandCopy';

export type FoodItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  rating: string | null;
  reviewCount: number;
  prepTime: number | null;
  maxDistance: number | null;
  allergens: string[];
  ingredients: string[];
  menuItems?: Array<{ name: string; categoryId?: string; categoryName?: string | null }>;
  addons?: Array<{
    name: string;
    kind?: 'sauce' | 'extra' | 'appetizer';
    pricing?: 'free' | 'paid';
    price?: number;
  }>;
  secondaryCategories?: Array<{ id: string; name: string }>;
  cuisine: string | null;
  stock: number;
  seller: { id: string; name: string; username?: string | null; image: string | null };
};

type Props = {
  food: FoodItem;
  onBack: () => void;
  onAddToCart: (food: FoodItem, quantity: number) => void;
  onOpenSellerReviews?: (sellerId: string) => void;
  onOpenSeller?: (sellerId: string) => void;
};

export default function FoodDetailScreen({ food, onBack, onAddToCart, onOpenSellerReviews, onOpenSeller }: Props) {
  const [quantity, setQuantity] = useState(1);

  function sellerIdentity(): string {
    const username = String(food.seller.username ?? "").trim().replace(/^@+/, "");
    if (!username) return food.seller.name;
    return `${food.seller.name} · @${username}`;
  }

  function handleAdd() {
    if (food.stock < quantity) {
      Alert.alert('Stok yetersiz', `Bu üründen en fazla ${food.stock} adet ekleyebilirsin.`);
      return;
    }
    onAddToCart(food, quantity);
    onBack();
  }

  function formatPrice(price: number): string {
    return '₺' + price.toFixed(2).replace('.', ',');
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Yemek Detayı" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image */}
        {food.imageUrl ? (
          <Image source={{ uri: food.imageUrl }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="fast-food-outline" size={64} color={theme.textSecondary} />
          </View>
        )}

        {/* Title + Price */}
        <View style={styles.titleCard}>
          <View style={styles.titleRow}>
            <Text style={styles.foodName}>{food.name}</Text>
            <Text style={styles.foodPrice}>{formatPrice(food.price)}</Text>
          </View>
          {food.cuisine ? <Text style={styles.cuisine}>{food.cuisine}</Text> : null}

          {/* Rating + Prep + Distance */}
          <View style={styles.metaRow}>
            {food.rating ? (
              <View style={styles.metaItem}>
                <Ionicons name="star" size={14} color={theme.starGold} />
                <Text style={styles.metaText}>{food.rating} ({food.reviewCount})</Text>
              </View>
            ) : null}
            {food.prepTime ? (
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={14} color="#71685F" />
                <Text style={styles.metaText}>{food.prepTime} dk</Text>
              </View>
            ) : null}
            {food.maxDistance ? (
              <View style={styles.metaItem}>
                <Ionicons name="navigate-outline" size={14} color="#71685F" />
                <Text style={styles.metaText}>{food.maxDistance} km</Text>
              </View>
            ) : null}
          </View>

          {/* Stock */}
          <View style={styles.stockRow}>
            <Ionicons name="cube-outline" size={14} color={food.stock > 0 ? '#3E845B' : theme.error} />
            <Text style={[styles.stockText, { color: food.stock > 0 ? '#3E845B' : theme.error }]}>
              {food.stock > 0 ? `${food.stock} adet mevcut` : 'Stok tükendi'}
            </Text>
          </View>
        </View>

        {/* Seller */}
        <View style={styles.section}>
          <SectionDivider icon="storefront-outline" label="Satıcı" />
          <View style={styles.sellerRow}>
            {food.seller.image ? (
              <Image source={{ uri: food.seller.image }} style={styles.sellerImg} />
            ) : (
              <View style={[styles.sellerImg, styles.sellerImgPlaceholder]}>
                <Ionicons name="person" size={18} color="#FFFFFF" />
              </View>
            )}
            <Text style={styles.sellerName}>{sellerIdentity()}</Text>
            {onOpenSellerReviews && (
              <ActionButton
                label="Yorumlar"
                onPress={() => onOpenSellerReviews(food.seller.id)}
                variant="soft"
                size="sm"
              />
            )}
          </View>
        </View>

        {/* Description */}
        {food.description ? (
          <View style={styles.section}>
            <SectionDivider icon="document-text-outline" label="Açıklama" />
            <Text style={styles.descText}>{food.description}</Text>
          </View>
        ) : null}

        {/* Allergens */}
        {food.allergens.length > 0 && (
          <View style={[styles.section, styles.allergenSection]}>
            <View style={styles.allergenHeaderRow}>
              <View style={{ marginBottom: 0 }}>
                <SectionDivider icon="warning-outline" label="Alerjenler" />
              </View>
              <TouchableOpacity
                style={styles.sellerLink}
                onPress={() => onOpenSeller ? onOpenSeller(food.seller.id) : onBack()}
                activeOpacity={0.7}
              >
                <Text style={styles.sellerLinkText}>{sellerIdentity()}</Text>
                <Ionicons name="chevron-forward" size={14} color="#3E845B" />
              </TouchableOpacity>
            </View>
            <View style={styles.tagRow}>
              {food.allergens.map((a, i) => (
                <View key={i} style={styles.allergenTag}>
                  <Ionicons name="alert-circle" size={12} color="#D4740B" />
                  <Text style={styles.allergenText}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Ingredients */}
        {food.ingredients.length > 0 && (
          <View style={styles.section}>
            <SectionDivider icon="leaf-outline" label="İçindekiler" />
            <View style={styles.tagRow}>
              {food.ingredients.map((ing, i) => (
                <View key={i} style={styles.ingredientTag}>
                  <Text style={styles.ingredientText}>{ing}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {Array.isArray(food.menuItems) && food.menuItems.length > 0 && (
          <View style={styles.section}>
            <SectionDivider icon="restaurant-outline" label="Menü İçeriği" />
            <View style={styles.tagRow}>
              {food.menuItems.map((item, i) => (
                <View key={`${item.name}-${i}`} style={styles.ingredientTag}>
                  <Text style={styles.ingredientText}>
                    {item.name}
                    {item.categoryName ? ` · ${item.categoryName}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Quantity + Add */}
        {food.stock > 0 && (
          <View style={styles.addSection}>
            <View style={styles.qtyRow}>
              <ActionButton
                label="-"
                onPress={() => setQuantity(Math.max(1, quantity - 1))}
                variant="soft"
                size="sm"
              />
              <Text style={styles.qtyText}>{quantity}</Text>
              <ActionButton
                label="+"
                onPress={() => setQuantity(Math.min(food.stock, quantity + 1))}
                variant="soft"
                size="sm"
              />
            </View>
            <ActionButton
              label={`${t('cta.home.addToCart')} — ${formatPrice(food.price * quantity)}`}
              onPress={handleAdd}
              variant="primary"
              fullWidth
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { paddingBottom: 40 },
  image: { width: '100%', height: 240, backgroundColor: '#E6DDD3' },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },

  titleCard: {
    margin: 16,
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  foodName: { color: theme.text, fontSize: 20, fontWeight: '800', flex: 1, marginRight: 12 },
  foodPrice: { color: theme.priceText, fontSize: 20, fontWeight: '800' },
  cuisine: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: '#71685F', fontSize: 13, fontWeight: '500' },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  stockText: { fontSize: 13, fontWeight: '600' },

  section: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 14,
  },
  allergenSection: { borderColor: '#F5D8A0', backgroundColor: '#FFFBF0' },
  allergenHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 },
  sellerLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sellerLinkText: { color: '#3E845B', fontSize: 13, fontWeight: '700' },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sellerImg: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.primary },
  sellerImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  sellerName: { color: theme.text, fontSize: 15, fontWeight: '700', flex: 1 },
  descText: { color: theme.text, fontSize: 14, lineHeight: 22 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allergenTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF4E5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  allergenText: { color: '#D4740B', fontSize: 12, fontWeight: '600' },
  ingredientTag: {
    backgroundColor: '#E4F2E7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ingredientText: { color: '#3E845B', fontSize: 12, fontWeight: '600' },

  addSection: { margin: 16, gap: 12 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  qtyText: { color: theme.text, fontSize: 22, fontWeight: '800', minWidth: 32, textAlign: 'center' },
});
