import { Linking, Platform } from 'react-native';

export type MapCoordinates = { lat: number; lng: number };

const autoOpenedMapKeys = new Set<string>();

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function extractAddressCoordinates(value: unknown): MapCoordinates | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const lat = toFiniteNumber(row.lat ?? row.latitude);
  const lng = toFiniteNumber(row.lng ?? row.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function openExternalMaps(
  address: string | null | undefined,
  coordinates: MapCoordinates | null,
): Promise<void> {
  const fallbackAddress = String(address ?? '').trim();
  const destination = coordinates
    ? `${coordinates.lat},${coordinates.lng}`
    : fallbackAddress;
  if (!destination) {
    throw new Error('No map destination available');
  }

  const encoded = encodeURIComponent(destination);
  const appleDirectionsUrl = `maps://?daddr=${encoded}&dirflg=d`;
  const googleNavUrl = `google.navigation:q=${encoded}&mode=d`;
  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  const candidates = Platform.OS === 'ios'
    ? [appleDirectionsUrl, googleDirectionsUrl]
    : [googleNavUrl, googleDirectionsUrl];

  for (const url of candidates) {
    const supported = await Linking.canOpenURL(url);
    if (!supported) continue;
    await Linking.openURL(url);
    return;
  }

  throw new Error('No supported external map application found');
}

export async function openExternalMapsOnce(
  key: string,
  address: string | null | undefined,
  coordinates: MapCoordinates | null,
): Promise<boolean> {
  if (autoOpenedMapKeys.has(key)) return false;
  autoOpenedMapKeys.add(key);
  try {
    await openExternalMaps(address, coordinates);
    return true;
  } catch (error) {
    autoOpenedMapKeys.delete(key);
    throw error;
  }
}
