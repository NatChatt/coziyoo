import AsyncStorage from '@react-native-async-storage/async-storage';

const HOME_HERO_IMAGE_URL_KEY = '@coziyoo:home_hero_image_url';

export async function loadCachedHomeHeroImageUrl(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(HOME_HERO_IMAGE_URL_KEY);
    if (!value) return null;
    const normalized = value.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export async function saveCachedHomeHeroImageUrl(url: string): Promise<void> {
  const normalized = url.trim();
  if (!normalized) return;
  try {
    await AsyncStorage.setItem(HOME_HERO_IMAGE_URL_KEY, normalized);
  } catch {
    // ignore cache write errors
  }
}

