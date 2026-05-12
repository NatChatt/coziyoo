// Optional native modules — loaded with try/require so the app keeps running
// when these packages are absent (e.g. Expo Go without prebuild, web target).

export let getColors: typeof import('react-native-image-colors').getColors | null = null;
try {
  getColors = require('react-native-image-colors').getColors;
} catch {
  // Native module not available — adaptive colors will use fallback
}

export let manipulateAsync: typeof import('expo-image-manipulator').manipulateAsync | null = null;
export let ManipulatorSaveFormat: typeof import('expo-image-manipulator').SaveFormat | null = null;
try {
  const imageManipulator = require('expo-image-manipulator');
  manipulateAsync = imageManipulator.manipulateAsync;
  ManipulatorSaveFormat = imageManipulator.SaveFormat;
} catch {
  // Optional at runtime; consumers must null-check.
}

export let fileSystemCacheDirectory: string | null = null;
export let fileSystemWriteAsStringAsync:
  | null
  | ((fileUri: string, contents: string, options?: { encoding?: string }) => Promise<void>) = null;
export let fileSystemGetInfoAsync: null | ((fileUri: string) => Promise<{ exists: boolean }>) = null;
export let fileSystemEncodingTypeBase64: string | null = null;
try {
  const fileSystem = require('expo-file-system');
  fileSystemCacheDirectory = fileSystem.cacheDirectory ?? null;
  fileSystemWriteAsStringAsync = fileSystem.writeAsStringAsync ?? null;
  fileSystemGetInfoAsync = fileSystem.getInfoAsync ?? null;
  fileSystemEncodingTypeBase64 = fileSystem.EncodingType?.Base64 ?? 'base64';
} catch {
  // Optional at runtime; inline image files fall back when unavailable.
}
