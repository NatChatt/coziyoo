import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

function CategoriesBlock() {
  return (
    <View style={styles.blockWrap}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <Text style={styles.viewAll}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {[...Array(5)].map((_, index) => (
          <View key={`cat-${index}`} style={styles.categoryCard}>
            <Ionicons name="pizza-outline" size={24} color="#b15735" />
            <Text style={styles.categoryText}>Pizza</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.sectionHeaderWithGap}>
        <Text style={styles.sectionTitle}>Newby Flavours</Text>
        <Text style={styles.viewAll}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {[...Array(3)].map((_, index) => (
          <View key={`new-${index}`} style={styles.newbyCard}>
            <Image
              source={require('../../assets/images/coziyoo-demo-burgur.webp')}
              style={styles.newbyImage}
            />
            <Text style={styles.newbyTitle}>Burger</Text>
            <Text style={styles.newbySubtitle}>Hot and Spicy Burger</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export default function CoziYooMasterHomeDemoScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView>
        <View style={styles.heroWrap}>
          <Image
            source={require('../../assets/images/coziyoo-demo-cover1.jpg')}
            style={styles.heroImage}
            resizeMode="cover"
          />

          <LinearGradient
            colors={[
              'rgba(253, 222, 183, 1)',
              'rgba(253, 222, 183, 1)',
              'rgba(253, 222, 183, 0)',
            ]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.heroLeftGradient}
          />

          <LinearGradient
            colors={['rgba(255, 251, 244, 1)', 'rgba(255, 255, 255, 0)']}
            locations={[0, 1]}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
            style={styles.heroBottomGradient}
            pointerEvents="none"
          />

          <View style={styles.heroOverlayContent}>
            <View>
              <View style={styles.heroRow}>
                <Image
                  source={require('../../assets/images/coziyoo-demo-avatar.jpeg')}
                  style={styles.avatar}
                />
                <Text style={styles.greeting}>Hi, John Doe</Text>
              </View>

              <Text style={styles.heroQuestion}>What should we eat today?</Text>

              <View style={styles.locationRow}>
                <Feather name="map-pin" size={16} color="#b15735" />
                <View>
                  <Text style={styles.locationTop}>London, 3km radius</Text>
                  <Text style={styles.locationBottom}>London, 3km radius</Text>
                </View>
                <Feather name="chevron-down" size={16} color="#b15735" />
              </View>
            </View>
          </View>
        </View>
        <View style={styles.searchBarWrap}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color="#8a8a8a" />
            <TextInput
              placeholder="Search food, restaurants..."
              placeholderTextColor="#9a9a9a"
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
        </View>

        <CategoriesBlock />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: '#fffbf4',
    flex: 1,
  },
  heroWrap: {
    position: 'relative',
    height: 210,
    overflow: 'hidden',
    backgroundColor: '#fddfb9',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '58%',
    height: 210,
  },
  heroLeftGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 210,
  },
  heroBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
  },
  heroOverlayContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 210,
    backgroundColor: 'rgba(0,0,0,0)',
    padding: 20,
    zIndex: 3,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 50,
  },
  greeting: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  heroQuestion: {
    fontSize: 16,
    fontWeight: '600',
    color: '#b15735',
    marginVertical: 10,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationTop: {
    fontSize: 12,
    color: '#b15735',
  },
  locationBottom: {
    fontSize: 10,
  },
  searchBar: {
    width: '100%',
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 25,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92, 64, 51, 0.15)',
  },
  searchBarWrap: {
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: '#3d3d3d',
  },
  blockWrap: {
    width: '90%',
    alignSelf: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderWithGap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  viewAll: {
    fontSize: 12,
    color: '#b15735',
  },
  categoryCard: {
    margin: 5,
    width: 60,
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5,
  },
  newbyCard: {
    margin: 5,
    width: 100,
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newbyImage: {
    width: 50,
    height: 50,
    borderRadius: 50,
  },
  newbyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5,
  },
  newbySubtitle: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 5,
  },
});
