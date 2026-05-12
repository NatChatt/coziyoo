import { Image, Platform } from 'react-native';

import { normalizeHexColor, pickSurfacePaletteColor } from './color';
import { getColors, ManipulatorSaveFormat, manipulateAsync } from './lazyNativeModules';

export function getImageSizeAsync(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

type BandSide = 'top' | 'bottom';

async function sampleImageBandPlatformColor(
  uri: string,
  fallback: string,
  side: BandSide,
  cropRatio: number,
): Promise<string> {
  if (!uri || !manipulateAsync || !ManipulatorSaveFormat || !getColors) {
    return normalizeHexColor(fallback);
  }
  try {
    const { width, height } = await getImageSizeAsync(uri);
    if (width < 4 || height < 4) return normalizeHexColor(fallback);
    const cropHeight = Math.max(24, Math.min(height, Math.round(height * cropRatio)));
    const originY = side === 'bottom' ? Math.max(0, height - cropHeight) : 0;
    const cropped = await manipulateAsync(
      uri,
      [{ crop: { originX: 0, originY, width, height: cropHeight } }],
      { compress: 0.5, format: ManipulatorSaveFormat.JPEG, base64: false },
    );
    const colors = await getColors(cropped.uri, {
      fallback: normalizeHexColor(fallback),
      cache: true,
      key: `${uri}#safe-${side}:${width}:${cropHeight}`,
    });
    let sampled = normalizeHexColor(fallback);
    if (Platform.OS === 'ios' && 'background' in colors) {
      sampled = normalizeHexColor(colors.background, sampled);
    } else if (Platform.OS === 'android' && 'dominant' in colors) {
      sampled = normalizeHexColor(colors.dominant, sampled);
    }
    return sampled;
  } catch {
    return normalizeHexColor(fallback);
  }
}

export function sampleImageTopBandColor(uri: string, fallback: string): Promise<string> {
  return sampleImageBandPlatformColor(uri, fallback, 'top', 0.18);
}

export function sampleImageBottomBandColor(uri: string, fallback: string): Promise<string> {
  return sampleImageBandPlatformColor(uri, fallback, 'bottom', 0.22);
}

// Samples the bottom 30% of the image and runs `pickSurfacePaletteColor` on the
// resulting palette — used by FoodCard to find a plate/table tone for card bg.
export async function sampleFoodCardSurfaceColor(uri: string, fallback: string): Promise<string> {
  if (!uri || !manipulateAsync || !ManipulatorSaveFormat || !getColors) {
    return fallback;
  }
  try {
    const { width, height } = await getImageSizeAsync(uri);
    if (width < 4 || height < 4) return fallback;
    const cropHeight = Math.max(32, Math.min(height, Math.round(height * 0.30)));
    const originY = Math.max(0, height - cropHeight);
    const cropped = await manipulateAsync(
      uri,
      [{ crop: { originX: 0, originY, width, height: cropHeight } }],
      { compress: 0.55, format: ManipulatorSaveFormat.JPEG, base64: false },
    );
    const result = await getColors(cropped.uri, {
      fallback,
      cache: true,
      key: `${uri}#food-card-bottom:${width}:${cropHeight}`,
    });
    return pickSurfacePaletteColor(result, fallback);
  } catch {
    return fallback;
  }
}
