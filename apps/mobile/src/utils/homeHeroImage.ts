import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fileSystemCacheDirectory,
  fileSystemDownloadAsync,
  fileSystemGetInfoAsync,
} from './lazyNativeModules';

const HOME_HERO_IMAGE_URL_KEY = '@coziyoo:home_hero_image_url';
const HOME_HERO_IMAGE_FILE_KEY = '@coziyoo:home_hero_image_file';
const HOME_HERO_IMAGE_CACHE_VERSION_KEY = '@coziyoo:home_hero_image_cache_version';
const HOME_HERO_IMAGE_CACHE_VERSION = 'canonical-v2';

function hashHeroUrl(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export async function loadCachedHomeHeroImageUrl(): Promise<string | null> {
  try {
    const version = await AsyncStorage.getItem(HOME_HERO_IMAGE_CACHE_VERSION_KEY);
    if (version !== HOME_HERO_IMAGE_CACHE_VERSION) return null;
    const fileUri = (await AsyncStorage.getItem(HOME_HERO_IMAGE_FILE_KEY))?.trim();
    if (fileUri && fileSystemGetInfoAsync) {
      const info = await fileSystemGetInfoAsync(fileUri);
      if (info.exists) return fileUri;
    }
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

export async function cacheHomeHeroImageUrl(url: string, cacheKey?: string | null): Promise<string | null> {
  const normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) return null;
  await saveCachedHomeHeroImageUrl(normalized);
  if (!fileSystemCacheDirectory || !fileSystemDownloadAsync || !fileSystemGetInfoAsync) {
    return normalized;
  }

  const stableKey = `${normalized}|${String(cacheKey ?? '').trim()}`;
  const fileUri = `${fileSystemCacheDirectory}coziyoo-home-hero-${hashHeroUrl(stableKey)}.jpg`;
  try {
    const info = await fileSystemGetInfoAsync(fileUri);
    if (!info.exists) {
      await fileSystemDownloadAsync(normalized, fileUri);
    }
    await AsyncStorage.setItem(HOME_HERO_IMAGE_CACHE_VERSION_KEY, HOME_HERO_IMAGE_CACHE_VERSION);
    await AsyncStorage.setItem(HOME_HERO_IMAGE_FILE_KEY, fileUri);
    return fileUri;
  } catch {
    return normalized;
  }
}
