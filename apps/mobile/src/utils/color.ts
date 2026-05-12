// Pure color utilities — hex/HSL conversions, lightness/contrast helpers,
// palette pickers for image-derived colors, and card-color builders.
// No React Native or native-module imports — keep this file pure.

export type CardColors = {
  bg: string;
  border: string;
  title: string;
  subtitle: string;
  price: string;
  meta: string;
  photoTitle: string;
  photoCuisine: string;
  photoStock: string;
  photoMeta: string;
};

export type HeroColors = {
  bg: string;
  gradTop: string;
  gradMid: string;
  gradLight: string;
  featherMain: string;
  featherSoft: string;
  overlay: string;
};

export const DEFAULT_HERO_SEED = '#F0BB82';

/* ------------------------------------------------------------------ */
/*  Internal primitives                                               */
/* ------------------------------------------------------------------ */

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex).replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; }
  else if (hp >= 1 && hp < 2) { r1 = x; g1 = c; }
  else if (hp >= 2 && hp < 3) { g1 = c; b1 = x; }
  else if (hp >= 3 && hp < 4) { g1 = x; b1 = c; }
  else if (hp >= 4 && hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, '0')}`.toUpperCase();
}

function colorFromHsl(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(
    ((h % 360) + 360) % 360,
    Math.max(0, Math.min(1, s)),
    Math.max(0, Math.min(1, l)),
  );
  return rgbToHex(r, g, b);
}

function isPaletteHexColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return /^#?[0-9a-fA-F]{6}$/.test(normalized);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export function normalizeHexColor(color: string, fallback = '#8A7B6A'): string {
  const normalized = color.trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return fallback;
  return withHash.toUpperCase();
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export function toRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(normalizeHexColor(hex));
  return `rgba(${r},${g},${b},${alpha})`;
}

export function blendHexColors(fromHex: string, toHex: string, ratio: number): string {
  const a = hexToRgb(fromHex);
  const b = hexToRgb(toHex);
  const t = clamp01(ratio);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bch = Math.round(a.b + (b.b - a.b) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bch.toString(16).padStart(2, '0')}`.toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Palette pickers — operate on react-native-image-colors result     */
/* ------------------------------------------------------------------ */

export function pickImagePaletteColor(result: any, fallback: string): string {
  const candidateKeys = [
    'vibrant', 'lightVibrant', 'primary', 'detail', 'secondary',
    'dominant', 'darkVibrant', 'muted', 'lightMuted', 'darkMuted',
    'average', 'background',
  ];

  type Candidate = { color: string; score: number };
  const candidates: Candidate[] = [];

  for (const key of candidateKeys) {
    const raw = result?.[key];
    if (!isPaletteHexColor(raw)) continue;
    const color = normalizeHexColor(raw);
    const { r, g, b } = hexToRgb(color);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.12) continue;
    const vibranceScore = s * 2.8;
    const midLightnessScore = 1 - Math.abs(l - 0.50);
    const darkPenalty = l < 0.22 ? 0.8 : 0;
    const muddyPenalty = s < 0.35 ? (0.35 - s) * 2.2 : 0;
    const lightPenalty = l > 0.80 ? (l - 0.80) * 3.5 : 0;
    const brownBand = h >= 16 && h <= 42;
    const brownPenalty = brownBand && l < 0.52 ? 0.5 : 0;
    const keyBoost =
      key === 'vibrant' || key === 'darkVibrant' ? 0.28 :
      key === 'primary' || key === 'detail' ? 0.18 :
      key === 'lightVibrant' ? 0.12 :
      key === 'secondary' ? 0.10 :
      key === 'dominant' ? 0.04 : 0;
    const score = vibranceScore + midLightnessScore + keyBoost
      - darkPenalty - muddyPenalty - lightPenalty - brownPenalty;
    candidates.push({ color, score });
  }

  if (!candidates.length) return normalizeHexColor(fallback);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].color;
}

// Picks a "surface/background" color (plate, table, cloth) — prefers muted tones over vibrant food colors.
export function pickSurfacePaletteColor(result: any, fallback: string): string {
  const candidateKeys = [
    'lightMuted', 'muted', 'background', 'average', 'darkMuted',
    'lightVibrant', 'dominant', 'vibrant', 'darkVibrant',
  ];

  type Candidate = { color: string; score: number };
  const candidates: Candidate[] = [];

  for (const key of candidateKeys) {
    const raw = result?.[key];
    if (!isPaletteHexColor(raw)) continue;
    const color = normalizeHexColor(raw);
    const { r, g, b } = hexToRgb(color);
    const { s, l } = rgbToHsl(r, g, b);
    if (s < 0.05) continue;
    const chromaScore = Math.min(s, 0.45) * 1.4;
    const lightnessScore = 1 - Math.abs(l - 0.62);
    const vibrantPenalty = s > 0.55 ? (s - 0.55) * 1.6 : 0;
    const darkPenalty = l < 0.30 ? (0.30 - l) * 2.0 : 0;
    const keyBoost =
      key === 'lightMuted' ? 0.30 :
      key === 'muted' ? 0.22 :
      key === 'background' ? 0.18 :
      key === 'average' ? 0.10 :
      key === 'darkMuted' ? 0.06 : 0;
    const score = chromaScore + lightnessScore + keyBoost - vibrantPenalty - darkPenalty;
    candidates.push({ color, score });
  }

  if (!candidates.length) return normalizeHexColor(fallback);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].color;
}

export function normalizeCardSurfaceColor(color: string, fallback = '#A98A72'): string {
  const safe = normalizeHexColor(color, fallback);
  const { r, g, b } = hexToRgb(safe);
  const { h, s, l } = rgbToHsl(r, g, b);
  const isRedFoodAccent = h <= 18 || h >= 344;
  const isHotOrangeAccent = h > 18 && h <= 38 && s > 0.48;

  if (isRedFoodAccent) {
    return colorFromHsl(24, Math.min(s, 0.18), Math.max(0.48, Math.min(l, 0.66)));
  }

  if (isHotOrangeAccent) {
    return colorFromHsl(h, Math.min(s, 0.26), Math.max(0.48, Math.min(l, 0.68)));
  }

  return colorFromHsl(h, Math.min(s, 0.34), Math.max(0.44, Math.min(l, 0.72)));
}

/* ------------------------------------------------------------------ */
/*  Card / hero color builders                                        */
/* ------------------------------------------------------------------ */

type CardColorVariant = 'card' | 'recommendation';

const CARD_COLOR_PROFILES: Record<CardColorVariant, {
  bg: number; border: number; title: number; subtitle: number; price: number; meta: number;
}> = {
  card:           { bg: 0.62, border: 0.38, title: 0.55, subtitle: 0.32, price: 0.48, meta: 0.28 },
  recommendation: { bg: 0.90, border: 0.72, title: 0.66, subtitle: 0.46, price: 0.56, meta: 0.38 },
};

function buildCardColors(dominant: string, variant: CardColorVariant = 'card'): CardColors {
  if (variant === 'card') {
    return {
      bg: '#FFFDF9',
      border: '#E8DED2',
      title: '#2F241D',
      subtitle: '#6F6256',
      price: '#4B3529',
      meta: '#7A6A5D',
      photoTitle: '#FFFFFF',
      photoCuisine: '#F7F1EA',
      photoStock: '#EEE4D8',
      photoMeta: '#E5D8C8',
    };
  }

  const safe = normalizeHexColor(dominant);
  const p = CARD_COLOR_PROFILES[variant];
  return {
    bg: lighten(safe, p.bg),
    border: lighten(safe, p.border),
    title: darken(safe, p.title),
    subtitle: darken(safe, p.subtitle),
    price: darken(safe, p.price),
    meta: darken(safe, p.meta),
    photoTitle: lighten(safe, 0.94),
    photoCuisine: lighten(safe, 0.88),
    photoStock: lighten(safe, 0.82),
    photoMeta: lighten(safe, 0.78),
  };
}

export const deriveCardColors = (dominant: string) => buildCardColors(dominant, 'card');
export const deriveRecommendationCardColors = (dominant: string) => buildCardColors(dominant, 'recommendation');

export function deriveHeroColors(dominant: string): HeroColors {
  const safe = normalizeHexColor(dominant);
  const { r, g, b } = hexToRgb(safe);
  const { h, s } = rgbToHsl(r, g, b);
  const vividSat = Math.max(0.38, Math.min(0.78, s * 1.1));
  return {
    bg: colorFromHsl(h, vividSat * 0.16, 0.965),
    gradTop: colorFromHsl(h, vividSat * 0.28, 0.935),
    gradMid: colorFromHsl(h, vividSat * 0.40, 0.885),
    gradLight: colorFromHsl(h, vividSat * 0.13, 0.960),
    featherMain: colorFromHsl(h, vividSat * 0.40, 0.885),
    featherSoft: colorFromHsl(h, vividSat * 0.24, 0.930),
    overlay: colorFromHsl(h, vividSat * 0.62, 0.70),
  };
}
