import { Dimensions, Image, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "react-native";

const { width } = Dimensions.get("window");
const referenceAspectRatio = 1365 / 1024;

export default function HomeScreen() {
  const topInset = StatusBar.currentHeight ?? 0;
  const imageHeight = width / referenceAspectRatio;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.imageFrame, { paddingTop: topInset + 8 }]}> 
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
