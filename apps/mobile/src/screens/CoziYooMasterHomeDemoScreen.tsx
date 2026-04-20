import { StatusBar } from "expo-status-bar";
import { Dimensions, Image, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");
const referenceAspectRatio = 1365 / 1024;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const imageHeight = width / referenceAspectRatio;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.imageFrame, { paddingTop: insets.top + 8 }]}> 
          <Image
            source={require("../../assets/images/reference-home-screen.jpeg")}
            style={[styles.referenceImage, { height: imageHeight }]}
            resizeMode="cover"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#111",
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  imageFrame: {
    alignItems: "center",
  },
  referenceImage: {
    width: width - 24,
    borderRadius: 18,
  },
});
