import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, StatusBar, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { t } from '../copy/brandCopy';

type FavoriteFood = {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  rating: string | null;
  sellerName: string;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenFood?: (foodId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function FavoritesScreen({ auth, onBack, onOpenFood, onAuthRefresh }: Props) {
  const [favorites, setFavorites] = useState<FavoriteFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFavorites = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    const result = await apiRequest<FavoriteFood[]>(
      '/v1/favorites',
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setFavorites(Array.isArray(result.data) ? result.data : []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [auth.accessToken, auth.userId, onAuthRefresh]);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  async function handleRemove(foodId: string) {
    const result = await apiRequest(
      `/v1/favorites/${foodId}`,
      auth,
      { method: 'DELETE', actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setFavorites((prev) => prev.filter((f) => f.id !== foodId));
    }
  }

  function formatPrice(price: number): string {
    return '₺' + price.toFixed(2).replace('.', ',');
  }

  function renderItem({ item }: { item: FavoriteFood }) {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => onOpenFood?.(item.id)}
      >
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Ionicons name="fast-food-outline" size={28} color={theme.textSecondary} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.cardSeller} numberOfLines={1}>{item.sellerName}</Text>
          <View style={styles.cardBottom}>
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
            {item.rating && (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color={theme.starGold} />
                <Text style={styles.ratingText}>{item.rating}</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity style={styles.heartBtn} onPress={() => handleRemove(item.id)}>
          <Ionicons name="heart" size={22} color="#C0392B" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.favorites.title')} onBack={onBack} />

      {loading ? (
        <LoadingState message={t('status.favorites.loading')} />
      ) : favorites.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title={t('headline.favorites.emptyTitle')}
          subtitle={t('helper.favorites.emptySubtitle')}
        />
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchFavorites(true); }} tintColor={theme.primary} />
          }
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  list: { padding: 16, paddingBottom: 40 },
  sep: { height: 12 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    overflow: 'hidden',
  },
  cardImage: { width: 90, height: 90, backgroundColor: '#E6DDD3' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: 12, justifyContent: 'space-between' },
  cardName: { color: theme.text, fontSize: 15, fontWeight: '700' },
  cardSeller: { color: '#71685F', fontSize: 12, marginTop: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  cardPrice: { color: theme.priceText, fontSize: 15, fontWeight: '800' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { color: '#71685F', fontSize: 12, fontWeight: '500' },
  heartBtn: {
    padding: 12,
    alignSelf: 'flex-start',
  },
});
