import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { loadSettings } from '../utils/settings';
import { type AuthSession } from '../utils/auth';
import { readJsonSafe } from '../utils/http';
import { HOME_FEED_CATEGORIES } from '../constants/foodCategories';

const LOCAL_HOME_HEADER_FALLBACK = require('../../assets/images/home-header-fallback.png');

type Props = {
  auth?: AuthSession | null;
  onBack: () => void;
};

type ApiFoodItem = {
  id: string;
  name?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
};

type FoodsResponse = {
  data?: ApiFoodItem[];
  homeHeaderImageUrl?: string;
  mobileHomeHeaderImageUrl?: string;
  headerImageUrl?: string;
  branding?: {
    homeHeaderImageUrl?: string;
    mobileHomeHeaderImageUrl?: string;
  };
  home?: {
    headerImageUrl?: string;
    heroImageUrl?: string;
  };
  theme?: {
    homeHeaderImageUrl?: string;
  };
  error?: { message?: string };
};

type DemoMeal = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  category: string;
};

function resolveHomeHeaderImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? root.data
      : root
  ) as Record<string, unknown>;
  const branding = (data.branding && typeof data.branding === 'object' ? data.branding : null) as Record<string, unknown> | null;
  const home = (data.home && typeof data.home === 'object' ? data.home : null) as Record<string, unknown> | null;
  const themeConfig = (data.theme && typeof data.theme === 'object' ? data.theme : null) as Record<string, unknown> | null;

  const candidates = [
    data.homeHeaderImageUrl,
    data.mobileHomeHeaderImageUrl,
    data.headerImageUrl,
    branding?.homeHeaderImageUrl,
    branding?.mobileHomeHeaderImageUrl,
    home?.headerImageUrl,
    home?.heroImageUrl,
    themeConfig?.homeHeaderImageUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate.trim())) {
      return candidate.trim();
    }
  }

  return null;
}

function pickMealImage(item: ApiFoodItem): string {
  const primary = String(item.imageUrl ?? '').trim();
  if (primary) return primary;

  const fromList = Array.isArray(item.imageUrls)
    ? item.imageUrls.map((value) => String(value ?? '').trim()).find(Boolean)
    : '';

  return fromList || 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=1200&q=80';
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Tümü: 'grid',
  Çorbalar: 'water-outline',
  'Ana Yemekler': 'restaurant-outline',
  Salata: 'leaf-outline',
  Meze: 'wine-outline',
  Tatlılar: 'ice-cream-outline',
  İçecekler: 'cafe-outline',
};

export default function BuyerHomeDemoScreen({ auth, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [heroSource, setHeroSource] = useState<ImageSourcePropType>(LOCAL_HOME_HEADER_FALLBACK);
  const [meals, setMeals] = useState<DemoMeal[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDemoData() {
      setLoading(true);
      setError(null);

      try {
        const { apiUrl } = await loadSettings();
        const response = await fetch(`${apiUrl}/v1/foods/`, {
          headers: {
            'Content-Type': 'application/json',
            'x-actor-role': 'buyer',
            ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
          },
        });

        const json = await readJsonSafe<FoodsResponse>(response);
        if (!response.ok || json?.error) {
          throw new Error(json?.error?.message ?? `Demo verisi alınamadı (${response.status})`);
        }

        const list = Array.isArray(json?.data) ? json.data : [];
        const mapped: DemoMeal[] = list.map((item) => ({
          id: String(item.id),
          title: String(item.name ?? 'Yemek'),
          subtitle: String(item.category ?? 'Şef menüsü'),
          imageUrl: pickMealImage(item),
          category: String(item.category ?? 'Ana Yemekler'),
        }));

        const heroUrl = resolveHomeHeaderImageUrl(json) ?? mapped[0]?.imageUrl ?? null;

        if (!cancelled) {
          setMeals(mapped);
          if (heroUrl) setHeroSource({ uri: heroUrl });
          else setHeroSource(LOCAL_HOME_HEADER_FALLBACK);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Demo yüklenemedi');
          setMeals([]);
          setHeroSource(LOCAL_HOME_HEADER_FALLBACK);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDemoData();
    return () => {
      cancelled = true;
    };
  }, [auth?.accessToken]);

  const filteredMeals = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('tr-TR');
    return meals.filter((meal) => {
      const categoryMatch = activeCategory === 'Tümü' || meal.category === activeCategory;
      if (!categoryMatch) return false;
      if (!query) return true;
      return meal.title.toLocaleLowerCase('tr-TR').includes(query);
    });
  }, [activeCategory, meals, search]);

  const newbyMeals = filteredMeals.slice(0, 8);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image source={heroSource} style={styles.heroImage} onError={() => setHeroSource(LOCAL_HOME_HEADER_FALLBACK)} />
          <View style={styles.heroOverlayLeft} />
          <View style={styles.heroOverlayBottom} />

          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={20} color="#3F3A33" />
            <Text style={styles.backText}>Demo</Text>
          </TouchableOpacity>

          <View style={styles.heroContent}>
            <View style={styles.heroRow}>
              <View style={styles.avatarWrap}>
                <Ionicons name="person" size={18} color="#5A6F57" />
              </View>
              <Text style={styles.heroTitle}>Hi, Ismet!</Text>
            </View>

            <Text style={styles.heroSubtitle}>What should we eat today?</Text>

            <View style={styles.locationRow}>
              <Feather name="map-pin" size={16} color="#B15735" />
              <View>
                <Text style={styles.locationTop}>London, 3 KM radius</Text>
                <Text style={styles.locationBottom}>London, 3 KM radius</Text>
              </View>
            </View>

            <View style={styles.searchBar}>
              <Feather name="search" size={20} color="#9B9B9B" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder="Search for food"
                placeholderTextColor="#A0A0A0"
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <Text style={styles.viewAll}>View All</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroller}>
          {HOME_FEED_CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category}
              style={[styles.chip, activeCategory === category && styles.chipActive]}
              activeOpacity={0.85}
              onPress={() => setActiveCategory(category)}
            >
              <Ionicons
                name={category === 'Tümü' ? 'grid' : (CATEGORY_ICONS[category] || 'restaurant-outline')}
                size={18}
                color={activeCategory === category ? '#fff' : '#5A3E2B'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.chipText, activeCategory === category && styles.chipTextActive]}>{category}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Newby Flavours</Text>
          <Text style={styles.viewAll}>View All</Text>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color="#4A7C59" />
          </View>
        ) : null}

        {!loading && error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading && !error ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newbyRow}>
            {newbyMeals.map((meal) => (
              <View key={meal.id} style={styles.newbyCard}>
                <Image source={{ uri: meal.imageUrl }} style={styles.newbyImage} />
                <Text style={styles.newbyTitle} numberOfLines={2}>{meal.title}</Text>
                <Text style={styles.newbySubtitle} numberOfLines={1}>{meal.subtitle}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFBF4' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  heroWrap: { position: 'relative', minHeight: 312, backgroundColor: '#FDE2B7' },
  heroImage: { width: '100%', height: 236 },
  heroOverlayLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 70,
    width: '100%',
    backgroundColor: 'rgba(253, 222, 183, 0.55)',
  },
  heroOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 136,
    height: 132,
    backgroundColor: 'rgba(255, 251, 244, 0.92)',
  },
  backBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backText: { color: '#3F3A33', fontWeight: '700', fontSize: 12 },
  heroContent: { marginTop: -10, paddingHorizontal: 18, paddingBottom: 10 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#EAF1E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 35, fontWeight: '800', color: '#1E1B17' },
  heroSubtitle: { fontSize: 16, fontWeight: '700', color: '#B15735', marginTop: 8 },
  locationRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationTop: { fontSize: 12, color: '#B15735' },
  locationBottom: { fontSize: 11, color: '#2D2D2D' },

  searchBar: {
    marginTop: 14,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(92,64,51,0.16)',
    borderRadius: 28,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#313131' },

  sectionHead: {
    marginTop: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#1F2525' },
  viewAll: { fontSize: 12, color: '#B15735', fontWeight: '600' },

  chipScroller: { marginTop: 10 },
  chipRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4EDE4',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#E4D7C8',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#4A7C59',
    borderColor: '#4A7C59',
  },
  chipText: {
    color: '#5A3E2B',
    fontWeight: '700',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#fff',
  },

  newbyRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  newbyCard: {
    width: 164,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E7DFD7',
  },
  newbyImage: { width: '100%', height: 92, borderRadius: 10, backgroundColor: '#EEE' },
  newbyTitle: { marginTop: 8, fontSize: 14, fontWeight: '700', color: '#2D2A26' },
  newbySubtitle: { marginTop: 2, fontSize: 12, color: '#777' },

  loadingWrap: { marginTop: 16, alignItems: 'center' },
  errorText: { marginTop: 16, paddingHorizontal: 16, color: '#9B2C2C' },
});
