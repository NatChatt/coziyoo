import { t } from '../copy/brandCopy';

export function formatSellerIdentity(name: string, username?: string | null): string {
  const cleanUsername = (username ?? '').trim().replace(/^@+/, '');
  if (!cleanUsername) return name;
  return `@${cleanUsername}`;
}

export function formatCuisineLabel(cuisine?: string | null): string {
  const value = (cuisine ?? '').trim();
  if (!value) return '';
  const lower = value.toLocaleLowerCase('tr-TR');
  if (lower.endsWith(' mutfağı') || lower.endsWith(' mutfagi')) return value;
  return `${value} ${t('helper.home.cuisineSuffix')}`;
}

export function isInlineBase64ImageUri(value: string | null | undefined): value is string {
  const raw = String(value ?? '').trim().toLocaleLowerCase('en-US');
  return raw.startsWith('data:image/') && raw.includes(';base64,');
}

export function hashInlineImageUri(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function inlineImageExtension(value: string): string {
  const lower = value.toLocaleLowerCase('en-US');
  if (lower.startsWith('data:image/png')) return 'png';
  if (lower.startsWith('data:image/webp')) return 'webp';
  return 'jpg';
}

export function resolveFoodPhotoTitleMetrics(text: string): { fontSize: number; lineHeight: number } {
  const length = text.trim().length;
  if (length >= 24) return { fontSize: 26, lineHeight: 30 };
  if (length >= 18) return { fontSize: 31, lineHeight: 35 };
  if (length >= 12) return { fontSize: 36, lineHeight: 39 };
  return { fontSize: 42, lineHeight: 44 };
}
