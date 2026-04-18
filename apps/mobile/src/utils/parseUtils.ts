export function parseApiDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "t", "yes", "y", "aktif", "active"].includes(normalized);
  }
  return false;
}
