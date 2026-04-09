import AsyncStorage from "@react-native-async-storage/async-storage";
import { INGREDIENTS_SEED_LIST } from "../constants/ingredientsSeedList";

const CUSTOM_INGREDIENTS_KEY = "@coziyoo:custom_ingredients_v1";

export async function loadIngredientLibrary(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_INGREDIENTS_KEY);
    const custom: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const all = [...new Set([...INGREDIENTS_SEED_LIST, ...custom])];
    return all.sort((a, b) => a.localeCompare(b, "tr-TR"));
  } catch {
    return [...INGREDIENTS_SEED_LIST];
  }
}

export async function addIngredientToLibrary(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_INGREDIENTS_KEY);
    const custom: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const key = trimmed.toLocaleLowerCase("tr-TR");
    const alreadyExists =
      custom.some((x) => x.toLocaleLowerCase("tr-TR") === key) ||
      INGREDIENTS_SEED_LIST.some((x) => x.toLocaleLowerCase("tr-TR") === key);
    if (!alreadyExists) {
      custom.push(trimmed);
      await AsyncStorage.setItem(CUSTOM_INGREDIENTS_KEY, JSON.stringify(custom));
    }
  } catch {
    // fail silently — picker still works with in-memory selection
  }
}
