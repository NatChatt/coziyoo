import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';

const { width } = Dimensions.get('window');
const HERO_HEIGHT = 252;
const HERO_BG = '#F4D5BD';
const PAGE_BG = '#FFF8F1';
const ACCENT = '#C86E4B';
const TEXT_DARK = '#2F241E';

const categories = ['Pizza', 'Sushi', 'Burger', 'Pasta', 'Salad'];
const flavours = [
  { title: 'Burger', subtitle: 'Hot and spicy burger' },
  { title: 'Pasta', subtitle: 'Creamy mushroom pasta' },
  { title: 'Noodles', subtitle: 'Asian stir-fried noodles' },
];

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionAction}>View All</Text>
    </View>
  );
}

function CategoriesBlock() {
  return (
    <View style={styles.sectionWrap}>
      <SectionHeader title="Categories" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {categories.map((item) => (
          <View key={item} style={styles.categoryCard}>
            <Ionicons name="pizza-outline" size={24} color={ACCENT} />
            <Text style={styles.categoryLabel}>{item}</Text>
          </View>
        ))}
      </ScrollView>

      <SectionHeader title="Newby Flavours" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.flavourRow}
      >
        {flavours.map((item) => (
          <View key={item.title} style={styles.flavourCard}>
            <Image
              source={require('../../assets/images/coziyoo-demo-burgur.webp')}
              style={styles.flavourImage}
            />
            <Text style={styles.flavourTitle}>{item.title}</Text>
            <Text style={styles.flavourSubtitle}>{item.subtitle}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export default function CoziYooMasterHomeDemoScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar translucent barStyle="dark-content" backgroundColor="transparent" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.hero}>
          <View style={styles.heroImageLayer}>
            <Image
              source={require('../../assets/images/coziyoo-demo-cover1.jpg')}
              style={styles.heroImage}
              resizeMode="cover"
            />

            <LinearGradient
              colors={[
                HERO_BG,
                'rgba(244, 213, 189, 0.96)',
                'rgba(244, 213, 189, 0.82)',
                'rgba(244, 213, 189, 0.42)',
                'rgba(244, 213, 189, 0.08)',
                'transparent',
              ]}
              locations={[0, 0.3, 0.52, 0.72, 0.86, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.heroLeftBlend}
            />

            <LinearGradient
              colors={[
                'rgba(255, 248, 241, 0)',
                'rgba(255, 248, 241, 0.28)',
                'rgba(255, 248, 241, 0.76)',
                PAGE_BG,
              ]}
              locations={[0, 0.45, 0.8, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.heroBottomBlend}
              pointerEvents="none"
            />
          </View>

          <View style={styles.heroContent}>
            <View style={styles.profileRow}>
              <Image
                source={require('../../assets/images/coziyoo-demo-avatar.jpeg')}
                style={styles.avatar}
              />
              <Text style={styles.greeting}>Hi, John Doe</Text>
            </View>

            <Text style={styles.heroTitle}>What should we eat today?</Text>

            <View style={styles.locationRow}>
              <Feather name="map-pin" size={15} color={ACCENT} />
              <View style={styles.locationTextWrap}>
                <Text style={styles.locationTitle}>London, 3km radius</Text>
                <Text style={styles.locationSubtitle}>London, 3km radius</Text>
              </View>
              <Feather name="chevron-down" size={16} color={ACCENT} />
            </View>

            <View style={styles.searchBar}>
              <Feather name="search" size={18} color="#A5A0A0" />
              <TextInput
                placeholder="Search food, restaurants..."
                placeholderTextColor="#B1ABAB"
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>
          </View>
        </View>

        <CategoriesBlock />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  hero: {
    height: HERO_HEIGHT,
    backgroundColor: HERO_BG,
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroImageLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImage: {
    position: 'absolute',
    right: -18,
    top: -4,
    width: width * 0.72,
    height: HERO_HEIGHT + 24,
  },
  heroLeftBlend: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: width * 0.76,
    height: HERO_HEIGHT,
  },
  heroBottomBlend: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
  },
  heroContent: {
    flex: 1,
    zIndex: 2,
    paddingTop: 18,
    paddingHorizontal: 18,
    justifyContent: 'space-between',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  greeting: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT_DARK,
  },
  heroTitle: {
    marginTop: 10,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: ACCENT,
  },
  locationRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationTextWrap: {
    marginLeft: 10,
    flex: 1,
  },
  locationTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: ACCENT,
  },
  locationSubtitle: {
    marginTop: 1,
    fontSize: 11,
    color: '#6B5448',
  },
  searchBar: {
    marginTop: 18,
    marginBottom: 18,
    minHeight: 44,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(114, 74, 56, 0.08)',
    shadowColor: '#9B6D54',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT_DARK,
  },
  sectionWrap: {
    paddingHorizontal: 18,
    paddingTop: 18,
    backgroundColor: PAGE_BG,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#251D19',
  },
  sectionAction: {
    fontSize: 12,
    color: ACCENT,
  },
  categoryRow: {
    paddingBottom: 6,
    gap: 10,
  },
  categoryCard: {
    width: 72,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#7C5E50',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  categoryLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: TEXT_DARK,
  },
  flavourRow: {
    paddingTop: 4,
    gap: 12,
  },
  flavourCard: {
    width: 148,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 16,
    shadowColor: '#7C5E50',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  flavourImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 10,
  },
  flavourTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_DARK,
  },
  flavourSubtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: '#7A6A62',
  },
});
