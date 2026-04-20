import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Dimensions,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const { width } = Dimensions.get("window");

const categories = ["Pizza", "Sushi", "Burger", "Pasta", "Salad"];

const CategoriesBlock = () => {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <Text style={styles.sectionLink}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
        {categories.map((label) => (
          <View key={label} style={styles.categoryCard}>
            <Ionicons name="pizza-outline" size={24} color="#c46b48" />
            <Text style={styles.categoryLabel}>{label}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.sectionHeader, { marginTop: 12 }]}> 
        <Text style={styles.sectionTitle}>Newby Flavours</Text>
        <Text style={styles.sectionLink}>View All</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
        {[...Array(3)].map((_, index) => (
          <View key={index} style={styles.flavourCard}>
            <Image
              source={require("../../assets/images/burgur.webp")}
              style={styles.flavourImage}
            />
            <Text style={styles.flavourTitle}>Burger</Text>
            <Text style={styles.flavourSubtitle}>Hot and Spicy Burger</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

export default function HomeScreen() {
  const topInset = StatusBar.currentHeight ?? 0;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.heroSection, { height: 244 + topInset }]}>
          <View style={styles.heroArtWrap}>
            <LinearGradient
              colors={["#f3d5be", "#f6dfcd", "#f9ece2"]}
              start={{ x: 0, y: 0.2 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            <Image
              source={require("../../assets/images/hero-food-fade.png")}
              style={styles.heroFoodImage}
              resizeMode="cover"
            />

            <LinearGradient
              colors={[
                "rgba(243,213,190,0.98)",
                "rgba(243,213,190,0.82)",
                "rgba(243,213,190,0.38)",
                "rgba(243,213,190,0)",
              ]}
              locations={[0, 0.45, 0.72, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.heroSoftBlend}
              pointerEvents="none"
            />

            <LinearGradient
              colors={[
                "rgba(255,251,244,0)",
                "rgba(255,251,244,0.35)",
                "rgba(255,251,244,0.92)",
                "#fffbf4",
              ]}
              locations={[0, 0.35, 0.8, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.heroBottomFade}
              pointerEvents="none"
            />
          </View>

          <View style={[styles.heroContent, { paddingTop: topInset + 20 }]}>
            <View style={styles.profileRow}>
              <Image
                source={require("../../assets/images/images1.jpeg")}
                style={styles.avatar}
              />
              <Text style={styles.greeting}>Hi, John Doe</Text>
            </View>

            <Text style={styles.headline}>What should we eat today?</Text>

            <View style={styles.locationRow}>
              <Feather name="map-pin" size={16} color="#c46b48" />
              <View>
                <Text style={styles.locationPrimary}>London, 3km radius</Text>
                <Text style={styles.locationSecondary}>London, 3km radius</Text>
              </View>
              <Feather name="chevron-down" size={16} color="#c46b48" />
            </View>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color="#a7a2a0" />
            <TextInput
              placeholder="Search food, restaurants..."
              placeholderTextColor="#b0acab"
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
        </View>

        <CategoriesBlock />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3d5be",
  },
  scrollContent: {
    backgroundColor: "#fffbf4",
  },
  heroSection: {
    height: 244,
    backgroundColor: "#f3d5be",
    overflow: "hidden",
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  heroArtWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  heroFoodImage: {
    position: "absolute",
    right: -56,
    top: -4,
    width: width * 0.86,
    height: 244,
  },
  heroSoftBlend: {
    position: "absolute",
    left: 0,
    top: 0,
    width: width * 0.72,
    height: 244,
  },
  heroBottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 78,
  },
  heroContent: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
    width: "61%",
    zIndex: 2,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  greeting: {
    fontSize: 16,
    fontWeight: "800",
    color: "#2f2822",
  },
  headline: {
    marginTop: 18,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    color: "#d06e45",
  },
  locationRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationPrimary: {
    fontSize: 12,
    color: "#c46b48",
  },
  locationSecondary: {
    fontSize: 11,
    color: "#3f3a37",
    opacity: 0.78,
  },
  searchWrap: {
    marginTop: -18,
    paddingHorizontal: 18,
    zIndex: 3,
  },
  searchBar: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(135, 111, 98, 0.08)",
    shadowColor: "#8f7969",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: "#3d3d3d",
  },
  sectionWrap: {
    width: "90%",
    alignSelf: "center",
    marginTop: 18,
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#2e2926",
  },
  sectionLink: {
    fontSize: 12,
    color: "#c46b48",
  },
  rowScroll: {
    paddingRight: 8,
  },
  categoryCard: {
    width: 86,
    marginRight: 10,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
    color: "#3b3531",
  },
  flavourCard: {
    width: 124,
    marginRight: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  flavourImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  flavourTitle: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 8,
    color: "#2e2926",
  },
  flavourSubtitle: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
    color: "#6a625c",
  },
});
