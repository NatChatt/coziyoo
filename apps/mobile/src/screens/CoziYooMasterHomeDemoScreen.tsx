import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Image,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const categories = ['Pizza', 'Sushi', 'Burger', 'Pasta', 'Salad'];
const flavours = [
  { title: 'Burger', subtitle: 'Hot and Spicy Burger' },
  { title: 'Pasta', subtitle: 'Creamy Alfredo Pasta' },
  { title: 'Salad', subtitle: 'Fresh and Green Bowl' },
];

function CategoriesBlock() {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <Text style={styles.viewAll}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
        {categories.map((label) => (
          <View key={label} style={styles.categoryCard}>
            <Ionicons name="pizza-outline" size={24} color="#c96f48" />
            <Text style={styles.categoryLabel}>{label}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.sectionHeader, { marginTop: 8 }]}>
        <Text style={styles.sectionTitle}>Newby Flavours</Text>
        <Text style={styles.viewAll}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar translucent barStyle="dark-content" backgroundColor="transparent" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroImageWrap}>
            <Image
              source={require('../../assets/images/coziyoo-demo-cover1.jpg')}
              style={styles.heroImage}
              resizeMode="cover"
            />

            <View style={styles.globalWarmTint} />

            <LinearGradient
              colors={[
                '#f4d9c2',
                'rgba(244, 217, 194, 0.98)',
                'rgba(244, 217, 194, 0.92)',
                'rgba(244, 217, 194, 0.72)',
                'rgba(244, 217, 194, 0.35)',
                'transparent',
              ]}
              locations={[0, 0.2, 0.42, 0.64, 0.82, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.leftBlend}
            />

            <LinearGradient
              colors={[
                'rgba(255, 248, 243, 0)',
                'rgba(255, 248, 243, 0.38)',
                'rgba(255, 248, 243, 0.78)',
                '#fff8f3',
              ]}
              locations={[0, 0.45, 0.8, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.bottomBlend}
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
              <Feather name="map-pin" size={16} color="#c96f48" />
              <View>
                <Text style={styles.locationPrimary}>London, 3km radius</Text>
                <Text style={styles.locationSecondary}>London, 3km radius</Text>
              </View>
              <Feather name="chevron-down" size={16} color="#c96f48" />
            </View>

            <View style={styles.searchBar}>
              <Feather name="search" size={18} color="#a8a0a0" />
              <TextInput
                placeholder="Search food, restaurants..."
                placeholderTextColor="#aaa3a3"
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
  safeArea: {
    flex: 1,
    backgroundColor: '#fff8f3',
  },
  hero: {
    height: 290,
    backgroundColor: '#f4d9c2',
    overflow: 'hidden',
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroImageWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImage: {
    position: 'absolute',
    top: -6,
    right: -74,
    width: '82%',
    height: 240,
  },
  globalWarmTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '82%',
    height: 240,
    backgroundColor: 'rgba(244, 217, 194, 0.20)',
  },
  leftBlend: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '84%',
    height: 240,
  },
  bottomBlend: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 108,
  },
  heroContent: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    justifyContent: 'space-between',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  greeting: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2f2620',
  },
  heroTitle: {
    marginTop: 18,
    fontSize: 17,
    fontWeight: '700',
    color: '#d26f4a',
  },
  locationRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationPrimary: {
    fontSize: 13,
    color: '#c96f48',
  },
  locationSecondary: {
    fontSize: 11,
    color: '#5b524b',
    marginTop: 1,
  },
  searchBar: {
    marginTop: 20,
    marginBottom: 24,
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(122, 87, 67, 0.08)',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#3d3d3d',
  },
  sectionWrap: {
    width: '100%',
    paddingHorizontal: 18,
    marginTop: 16,
    paddingBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2f2620',
  },
  viewAll: {
    fontSize: 13,
    color: '#c96f48',
  },
  rowScroll: {
    paddingRight: 8,
  },
  categoryCard: {
    width: 86,
    height: 98,
    marginRight: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3a312b',
    marginTop: 8,
  },
  flavourCard: {
    width: 138,
    marginRight: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  flavourImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  flavourTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2f2620',
    marginTop: 8,
  },
  flavourSubtitle: {
    fontSize: 11,
    color: '#6b625c',
    marginTop: 4,
    textAlign: 'center',
  },
});
