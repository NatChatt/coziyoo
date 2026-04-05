import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { HOME_FOOD_CATEGORIES } from "../constants/foodCategories";
import { formatCopy, t } from "../copy/brandCopy";

const SELLER_FORM_PERSIST_KEY_PREFIX = "seller_food_form_fields_v1";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  initialEditFoodId?: string | null;
  initialEditFood?: SellerFood | null;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  cardSummary: string | null;
  description: string | null;
  recipe: string | null;
  cuisine: string | null;
  menuItems?: Array<{
    name: string;
    categoryId?: string;
    categoryName?: string | null;
    kind?: "sauce" | "extra" | "appetizer";
    pricing?: "free" | "paid";
    price?: number;
  }>;
  secondaryCategories?: Array<{ id: string; name: string }>;
  price: number;
  imageUrl: string | null;
  imageUrls: string[];
  ingredients: string[];
  allergens: string[];
  preparationTimeMinutes: number | null;
  isActive: boolean;
  stock: number;
};

type FoodCategoryOption = {
  id: string;
  name: string;
};

type AddonKind = "sauce" | "extra" | "appetizer";
type AddonPricing = "free" | "paid";
type SellerMenuAddon = {
  name: string;
  kind: AddonKind;
  pricing: AddonPricing;
  price?: number;
};

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "t", "yes", "y", "aktif", "active"].includes(normalized);
  }
  return false;
}

function normalizeSellerFood(item: Record<string, unknown>): SellerFood {
  const imageUrlsRaw = Array.isArray(item.imageUrls)
    ? item.imageUrls
    : Array.isArray(item.image_urls_json)
      ? item.image_urls_json
      : [];

  const menuItemsRaw = Array.isArray(item.menuItems)
    ? item.menuItems
    : Array.isArray(item.menu_items_json)
      ? item.menu_items_json
      : [];

  return {
    id: String(item.id ?? ""),
    categoryId: typeof item.categoryId === "string" ? item.categoryId : (typeof item.category_id === "string" ? item.category_id : null),
    categoryName: typeof item.categoryName === "string" ? item.categoryName : (typeof item.category_name === "string" ? item.category_name : null),
    name: String(item.name ?? ""),
    cardSummary: typeof item.cardSummary === "string" ? item.cardSummary : null,
    description: typeof item.description === "string" ? item.description : null,
    recipe: typeof item.recipe === "string" ? item.recipe : null,
    cuisine: typeof item.cuisine === "string" ? item.cuisine : null,
    menuItems: menuItemsRaw as SellerFood["menuItems"],
    secondaryCategories: Array.isArray(item.secondaryCategories) ? (item.secondaryCategories as SellerFood["secondaryCategories"]) : [],
    price: Number(item.price ?? 0),
    imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : (typeof item.image_url === "string" ? item.image_url : null),
    imageUrls: imageUrlsRaw.map((url) => String(url ?? "")).filter(Boolean).slice(0, 5),
    ingredients: Array.isArray(item.ingredients) ? item.ingredients.map((v) => String(v ?? "")).filter(Boolean) : [],
    allergens: Array.isArray(item.allergens) ? item.allergens.map((v) => String(v ?? "")).filter(Boolean) : [],
    preparationTimeMinutes: Number.isFinite(Number(item.preparationTimeMinutes))
      ? Number(item.preparationTimeMinutes)
      : (Number.isFinite(Number(item.preparation_time_minutes)) ? Number(item.preparation_time_minutes) : null),
    isActive: toBool(item.isActive ?? item.is_active),
    stock: Number(item.stock ?? 0),
  };
}

const ADDON_KIND_OPTIONS: Array<{ value: AddonKind; label: string }> = [
  { value: "sauce", label: "label.seller.foods.kindSauce" },
  { value: "extra", label: "label.seller.foods.kindExtra" },
  { value: "appetizer", label: "label.seller.foods.kindAppetizer" },
];

function fallbackHomeCategoryOptions(): FoodCategoryOption[] {
  return HOME_FOOD_CATEGORIES.map((name) => ({
    id: `home:${name.toLocaleLowerCase("tr-TR").replace(/\s+/g, "-")}`,
    name,
  }));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function parseDisplayDateToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.toISOString();
}

function normalizeIngredientTyping(prev: string, next: string): string {
  if (
    next.length > prev.length &&
    next.endsWith(" ") &&
    !next.endsWith(", ")
  ) {
    const trimmed = next.trimEnd();
    if (!trimmed) return "";
    if (trimmed.endsWith(",")) return `${trimmed} `;
    return `${trimmed}, `;
  }
  return next;
}

function parseLocalizedDecimal(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const noCurrency = trimmed.replace(/[₺\s]/g, "");
  const normalizedComma = noCurrency.replace(/,/g, ".");
  const safe = normalizedComma.replace(/[^0-9.]/g, "");
  if (!safe) return Number.NaN;
  const parts = safe.split(".");
  const normalized =
    parts.length <= 1 ? safe : `${parts.shift()}.${parts.join("")}`;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function parseResponseBodySafe(res: Response): Promise<unknown> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { rawText: raw } as { rawText: string };
  }
}

function resolveApiMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.error && typeof obj.error === "object") {
      const err = obj.error as Record<string, unknown>;
      if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
    }
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
    if (typeof obj.rawText === "string") {
      const raw = obj.rawText.trim();
      if (raw.startsWith("<")) {
        return t('error.seller.foods.serverHtml');
      }
    }
  }
  return fallback;
}

function parseFreeAddonNames(value: string): string[] {
  const normalizedInput = value
    .replace(/\s+(ve|ile)\s+/gi, ", ")
    .replace(/\s*&\s*/g, ", ");
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of normalizedInput.split(/[,;\n]/g)) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(name);
  }
  return items;
}

export default function SellerFoodsScreen({ auth, onBack, initialEditFoodId, initialEditFood, onAuthRefresh }: Props) {
  const PLACEHOLDER_COLOR = "#8A7A6A";
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [categories, setCategories] = useState<FoodCategoryOption[]>([]);
  const [editingFood, setEditingFood] = useState<SellerFood | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cardSummary, setCardSummary] = useState("");
  const [description, setDescription] = useState("");
  const [recipe, setRecipe] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [allergens, setAllergens] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>(["", "", "", "", ""]);
  const [movingImageIndex, setMovingImageIndex] = useState<number | null>(null);
  const longPressConsumedIndexRef = useRef<number | null>(null);
  const imagePickerOpeningRef = useRef(false);
  const [prepTime, setPrepTime] = useState("");

  // UI parity fields (opsiyonlar)
  const [cuisine, setCuisine] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dailyStock, setDailyStock] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [datePickerVisible, setDatePickerVisible] = useState<null | "start" | "end">(null);
  const [pickerMonth, setPickerMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [menuItems, setMenuItems] = useState<SellerMenuAddon[]>([]);
  const [freeAddonNameInput, setFreeAddonNameInput] = useState("");
  const [freeAddonKindInput, setFreeAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonNameInput, setPaidAddonNameInput] = useState("");
  const [paidAddonKindInput, setPaidAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonPriceInput, setPaidAddonPriceInput] = useState("");
  const [addonLibraryVisible, setAddonLibraryVisible] = useState(false);
  const [addonLibraryKind, setAddonLibraryKind] = useState<AddonKind>("extra");
  const [addonLibraryPricing, setAddonLibraryPricing] = useState<AddonPricing>("free");
  const [persistentFieldsHydrated, setPersistentFieldsHydrated] = useState(false);
  const [pendingInitialEditId, setPendingInitialEditId] = useState<string | null>(
    initialEditFood ? null : (initialEditFoodId ?? null),
  );
  const formPersistKey = useMemo(
    () => `${SELLER_FORM_PERSIST_KEY_PREFIX}:${currentAuth.userId}`,
    [currentAuth.userId],
  );

  useEffect(() => setCurrentAuth(auth), [auth]);
  useEffect(() => {
    setPendingInitialEditId(initialEditFood ? null : (initialEditFoodId ?? null));
  }, [initialEditFoodId, initialEditFood]);

  useEffect(() => {
    let active = true;
    setPersistentFieldsHydrated(false);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(formPersistKey);
        if (!active) return;
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          startDate?: unknown;
          endDate?: unknown;
        };
        const hasInitialEditContext = Boolean(initialEditFood || initialEditFoodId);
        if (!hasInitialEditContext) {
          setStartDate(typeof parsed.startDate === "string" ? parsed.startDate : "");
          setEndDate(typeof parsed.endDate === "string" ? parsed.endDate : "");
        }
      } catch (error) {
        console.warn("[seller-foods] failed to load persisted form fields", error);
      } finally {
        if (active) setPersistentFieldsHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [formPersistKey, initialEditFood, initialEditFoodId]);

  useEffect(() => {
    if (!persistentFieldsHydrated) return;
    const payload = JSON.stringify({
      startDate: startDate.trim(),
      endDate: endDate.trim(),
    });
    AsyncStorage.setItem(formPersistKey, payload).catch((error) => {
      console.warn("[seller-foods] failed to persist form fields", error);
    });
  }, [persistentFieldsHydrated, formPersistKey, startDate, endDate]);

  useLayoutEffect(() => {
    if (!initialEditFood) return;
    openEdit(initialEditFood);
    setPendingInitialEditId(null);
  }, [initialEditFood]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401 && res.status !== 403) return res;

    // Another screen may have already refreshed auth; try persisted session first.
    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401 && res.status !== 403) return res;
    }

    const refreshed = await refreshAuthSession(baseUrl, persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: makeHeaders(refreshed),
    });
  }

  async function loadFoods() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/seller/foods", undefined, baseUrl);
      const json = await parseResponseBodySafe(res);
      if (!res.ok) {
        console.warn("[seller-foods-screen] foods fetch failed", {
          status: res.status,
          message: resolveApiMessage(json, t('error.seller.foods.load')),
          userId: currentAuth.userId,
          actorRole: "seller",
        });
        throw new Error(resolveApiMessage(json, t('error.seller.foods.load')));
      }
      const payload = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};
      const rows: SellerFood[] = Array.isArray(payload.data)
        ? (payload.data as unknown[]).map((item: unknown) => normalizeSellerFood((item ?? {}) as Record<string, unknown>))
        : [];
      console.info("[seller-foods-screen] foods loaded", {
        count: rows.length,
        userId: currentAuth.userId,
      });
      setFoods(rows);
      void loadCategories(baseUrl);
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foods.load'));
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories(baseUrl = apiUrl) {
    try {
      setLoadingCategories(true);
      const res = await authedFetch("/v1/seller/categories", undefined, baseUrl);
      const json = await parseResponseBodySafe(res);
      if (!res.ok) throw new Error(resolveApiMessage(json, t('error.seller.foods.categoriesLoad')));
      const payload = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};
      const items: unknown[] = Array.isArray(payload.data) ? (payload.data as unknown[]) : [];
      const mapped =
        items
          .map((item) => {
            const row = item as { id?: unknown; nameTr?: unknown; name?: unknown };
            const id = typeof row.id === "string" ? row.id : "";
            const nameTr = typeof row.nameTr === "string" ? row.nameTr.trim() : "";
            const fallbackName = typeof row.name === "string" ? row.name.trim() : "";
            return {
              id,
              name: nameTr || fallbackName,
            };
          })
          .filter((item) => item.id && item.name);

      setCategories(mapped.length > 0 ? mapped : fallbackHomeCategoryOptions());
    } catch (e) {
      console.warn("[seller-foods] categories load failed:", e);
      setCategories(fallbackHomeCategoryOptions());
    } finally {
      setLoadingCategories(false);
    }
  }

  useEffect(() => {
    void loadFoods();
  }, []);

  useEffect(() => {
    if (!pendingInitialEditId) return;
    const target = foods.find((item) => String((item as { id?: unknown }).id ?? "") === pendingInitialEditId);
    if (!target) {
      if (!loading) {
        setPendingInitialEditId(null);
        Alert.alert(t('headline.common.error'), t('error.seller.foods.editTargetMissing'));
      }
      return;
    }
    openEdit(target);
    setPendingInitialEditId(null);
  }, [pendingInitialEditId, foods, loading]);

  function resetForm() {
    setEditingFood(null);
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setIngredients("");
    setAllergens("");
    setImageUrls(["", "", "", "", ""]);
    setMovingImageIndex(null);
    setPrepTime("");
    setCuisine("");
    setCategoryId("");
    setDailyStock("");
    setMenuItems([]);
    setFreeAddonNameInput("");
    setFreeAddonKindInput("extra");
    setPaidAddonNameInput("");
    setPaidAddonKindInput("extra");
    setPaidAddonPriceInput("");
  }

  function openEdit(food: SellerFood) {
    setEditingFood(food);
    setName(food.name);
    setPrice(String(food.price));
    setCardSummary(food.cardSummary ?? "");
    setDescription(food.description ?? "");
    setRecipe(food.recipe ?? "");
    setIngredients(Array.isArray(food.ingredients) ? food.ingredients.join(", ") : "");
    setAllergens(Array.isArray(food.allergens) ? food.allergens.join(", ") : "");
    const seededImageUrls = (food.imageUrls?.length ? food.imageUrls : [food.imageUrl ?? ""]).slice(0, 5);
    while (seededImageUrls.length < 5) seededImageUrls.push("");
    setImageUrls(seededImageUrls);
    setMovingImageIndex(null);
    setPrepTime(food.preparationTimeMinutes ? String(food.preparationTimeMinutes) : "");
    setCuisine(food.cuisine ?? "");
    setCategoryId(food.categoryId ?? "");
    setDailyStock(food.stock > 0 ? String(food.stock) : "");
    const normalizedMenuItems = Array.isArray(food.menuItems)
      ? food.menuItems
        .map((item) => ({
          name: String(item?.name ?? "").trim(),
          kind: (item?.kind === "sauce" || item?.kind === "appetizer" ? item.kind : "extra") as AddonKind,
          pricing: (item?.pricing === "paid" ? "paid" : "free") as AddonPricing,
          price: typeof item?.price === "number" && Number.isFinite(item.price) ? Number(item.price) : undefined,
        }))
        .filter((item) => item.name)
        .map((item) => (
          item.pricing === "paid" && Number.isFinite(item.price)
            ? { ...item, price: Number(item.price) }
            : { name: item.name, kind: item.kind, pricing: "free" as const }
        ))
      : [];
    const freeAddonNames = normalizedMenuItems
      .filter((item) => item.pricing === "free")
      .map((item) => item.name.trim())
      .filter(Boolean);
    setMenuItems(normalizedMenuItems.filter((item) => item.pricing === "paid"));
    setFreeAddonNameInput(freeAddonNames.join(", "));
    setFreeAddonKindInput("extra");
    setPaidAddonNameInput("");
    setPaidAddonKindInput("extra");
    setPaidAddonPriceInput("");
  }

  function setImageAt(index: number, value: string) {
    setImageUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function moveImage(from: number, to: number) {
    if (from === to) {
      setMovingImageIndex(null);
      return;
    }
    setImageUrls((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setMovingImageIndex(null);
  }

  async function pickImageFromAlbum(index: number) {
    if (imagePickerOpeningRef.current) return;
    try {
      imagePickerOpeningRef.current = true;
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }
      if (!permission.granted) {
        Alert.alert(t('headline.common.permission'), t('error.seller.foods.galleryPermission'));
        return;
      }

      setMovingImageIndex(null);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.75,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.imageDataMissing'));
        return;
      }
      const mimeType = asset.mimeType ?? "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${asset.base64}`;
      setImageAt(index, dataUrl);
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foods.imagePick'));
    } finally {
      imagePickerOpeningRef.current = false;
    }
  }

  async function saveFood(options?: { publishAfterSave?: boolean }) {
    try {
      const pendingFreeAddonNames = parseFreeAddonNames(freeAddonNameInput);
      const paidOnlyItems = menuItems.filter((item) => item.pricing === "paid");
      const freeItems: SellerMenuAddon[] = pendingFreeAddonNames.map((name) => ({
        name,
        kind: "extra",
        pricing: "free",
      }));
      const workingMenuItems: SellerMenuAddon[] = [...paidOnlyItems, ...freeItems];
      const parsedPrice = parseLocalizedDecimal(price);
      const parsedPrepTime = prepTime.trim() ? Number.parseInt(prepTime.trim(), 10) : Number.NaN;
      const parsedDailyStock = dailyStock.trim() ? Number.parseInt(dailyStock.trim(), 10) : Number.NaN;
      const parsedAllergens = allergens
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const startIsoRequired = parseDisplayDateToIso(startDate);
      const endIsoRequired = parseDisplayDateToIso(endDate);

      if (!name.trim()) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.nameRequired'));
        return;
      }
      if (!isUuid(categoryId)) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.categoryRequired'));
        return;
      }
      if (!cuisine.trim()) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.cuisineRequired'));
        return;
      }
      if (!description.trim()) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.ingredientsRequired'));
        return;
      }
      if (!recipe.trim()) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.recipeRequired'));
        return;
      }
      if (parsedAllergens.length === 0) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.allergensRequired'));
        return;
      }
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.priceRequired'));
        return;
      }
      if (!Number.isFinite(parsedDailyStock) || parsedDailyStock <= 0) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.stockRequired'));
        return;
      }
      if (!Number.isFinite(parsedPrepTime) || parsedPrepTime <= 0) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.prepRequired'));
        return;
      }
      if (!startIsoRequired || !endIsoRequired) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.datesRequired'));
        return;
      }
      if (new Date(endIsoRequired).getTime() <= new Date(startIsoRequired).getTime()) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.endDateInvalid'));
        return;
      }
      if (workingMenuItems.length < 1) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.addonsRequired'));
        return;
      }

      setSaving(true);

      const primaryImageUrl = imageUrls.map((x) => x.trim()).find(Boolean) || undefined;
      const ingredientItemsFromDescription = description
        .split(/[,;\n]/g)
        .map((x) => x.trim())
        .filter(Boolean);
      const ingredientItemsFromInput = ingredients
        .split(/[,;\n]/g)
        .map((x) => x.trim())
        .filter(Boolean);
      const normalizedIngredients = ingredientItemsFromInput.length > 0
        ? ingredientItemsFromInput
        : ingredientItemsFromDescription;
      const normalizedAddons = workingMenuItems.map((item) => ({
        name: item.name.trim(),
        kind: item.kind,
        pricing: item.pricing,
        ...(item.pricing === "paid" && Number.isFinite(item.price) ? { price: Number(item.price) } : {}),
      }));
      const invalidPaidAddon = normalizedAddons.find(
        (item) => item.pricing === "paid" && (!("price" in item) || Number(item.price) <= 0),
      );
      if (invalidPaidAddon) {
        Alert.alert(t('headline.common.error'), t('error.seller.foods.paidAddonPrice'));
        return;
      }
      const payload: Record<string, unknown> = {
        name: name.trim(),
        price: parsedPrice,
        cardSummary: cardSummary.trim() || undefined,
        description: description.trim() || undefined,
        recipe: recipe.trim() || undefined,
        imageUrl: primaryImageUrl,
        imageUrls: imageUrls.map((x) => x.trim()).filter(Boolean).slice(0, 5),
        cuisine: cuisine.trim() || undefined,
        ingredients: normalizedIngredients,
        allergens: parsedAllergens,
        preparationTimeMinutes: parsedPrepTime,
        menuItems: normalizedAddons,
        secondaryCategoryIds: [],
      };

      payload.categoryId = categoryId.trim();

      const path = editingFood ? `/v1/seller/foods/${editingFood.id}` : "/v1/seller/foods";
      const method = editingFood ? "PATCH" : "POST";
      const res = await authedFetch(path, { method, body: JSON.stringify(payload) });
      const json = await parseResponseBodySafe(res);
      if (!res.ok) throw new Error(resolveApiMessage(json, "Kaydedilemedi"));
      const responsePayload = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};
      const responseData = (responsePayload.data && typeof responsePayload.data === "object")
        ? (responsePayload.data as Record<string, unknown>)
        : null;

      const foodId = editingFood?.id ?? (typeof responseData?.foodId === "string" ? responseData.foodId : null);

      if (options?.publishAfterSave && foodId) {
        const startIso = startIsoRequired;
        const endIso = endIsoRequired;
        const nowTs = Date.now();
        let saleStartsAt = startIso ?? new Date(nowTs).toISOString();
        let saleEndsAt = endIso;
        let hadInvalidDateWindow = false;
        if (!saleEndsAt) {
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 30);
          saleEndsAt = fallback.toISOString();
        }
        if (new Date(saleStartsAt).getTime() > nowTs) {
          hadInvalidDateWindow = true;
          // "Yayınla" aksiyonunda ürünün hemen görünmesi beklenir.
          saleStartsAt = new Date(nowTs).toISOString();
          if (new Date(saleEndsAt).getTime() <= new Date(saleStartsAt).getTime()) {
            const fallback = new Date(saleStartsAt);
            fallback.setUTCDate(fallback.getUTCDate() + 30);
            saleEndsAt = fallback.toISOString();
          }
        }
        if (new Date(saleEndsAt).getTime() <= nowTs) {
          hadInvalidDateWindow = true;
          // Prevent creating immediately expired lots; keep publish visible on home feed.
          if (new Date(saleStartsAt).getTime() < nowTs) {
            saleStartsAt = new Date(nowTs).toISOString();
          }
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 30);
          saleEndsAt = fallback.toISOString();
        }
        if (new Date(saleEndsAt).getTime() <= new Date(saleStartsAt).getTime()) {
          hadInvalidDateWindow = true;
          const fallback = new Date(saleStartsAt);
          fallback.setUTCDate(fallback.getUTCDate() + 1);
          saleEndsAt = fallback.toISOString();
        }
        if (hadInvalidDateWindow) {
          Alert.alert(
            t('status.seller.foods.publishDateFixedTitle'),
            t('status.seller.foods.publishDateFixedBody'),
          );
        }

        const producedAt = saleStartsAt;
        const quantityProduced = Math.max(1, parsedDailyStock || 1);
        const statusRes = await authedFetch(`/v1/seller/foods/${foodId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: true }),
        });
        if (!statusRes.ok) {
          const statusJson = await parseResponseBodySafe(statusRes);
          throw new Error(resolveApiMessage(statusJson, "Yemek durumu güncellenemedi"));
        }

        let hasVisibleLot = false;
        const lotsRes = await authedFetch(`/v1/seller/lots?foodId=${foodId}`);
        if (lotsRes.ok) {
          const lotsJson = await parseResponseBodySafe(lotsRes);
          const lotsPayload = (lotsJson && typeof lotsJson === "object")
            ? (lotsJson as Record<string, unknown>)
            : {};
          const lots = Array.isArray(lotsPayload.data) ? (lotsPayload.data as unknown[]) : [];
          const now = Date.now();
          hasVisibleLot = lots.some((lot: any) => {
            const status = String(lot?.status ?? "").toLowerCase();
            const qty = Number(lot?.quantity_available ?? 0);
            const startsAt = Date.parse(String(lot?.sale_starts_at ?? ""));
            const endsAt = Date.parse(String(lot?.sale_ends_at ?? ""));
            return (
              status === "active" &&
              qty > 0 &&
              Number.isFinite(startsAt) &&
              Number.isFinite(endsAt) &&
              startsAt <= now &&
              endsAt > now
            );
          });
        }

        if (!hasVisibleLot) {
          const lotRes = await authedFetch("/v1/seller/lots", {
            method: "POST",
            body: JSON.stringify({
              foodId,
              producedAt,
              saleStartsAt,
              saleEndsAt,
              quantityProduced,
              quantityAvailable: quantityProduced,
              notes: "mobile_publish",
            }),
          });
          const lotJson = await parseResponseBodySafe(lotRes);
          if (!lotRes.ok) {
            throw new Error(resolveApiMessage(lotJson, "Lot oluşturulamadı"));
          }
        }
      }

      await loadFoods();
      resetForm();
      if (options?.publishAfterSave) {
        Alert.alert(
          "Başarılı",
          editingFood ? "Yemek güncellenip yayınlandı." : "Yemek yayınlandı.",
          [{ text: t('headline.common.success'), onPress: onBack }],
        );
      } else {
        Alert.alert(t('status.seller.foods.publishedTitle'), editingFood ? t('status.seller.foods.savedBodyEdit') : t('status.seller.foods.savedBodyNew'));
      }
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foods.save'));
    } finally {
      setSaving(false);
    }
  }

  function addAddon() {
    const rawName = paidAddonNameInput.trim().replace(/\s+/g, " ");
    if (!rawName) {
      Alert.alert(t('headline.common.error'), t('error.seller.foods.addonNameRequired'));
      return;
    }
    const pricing: AddonPricing = "paid";
    const kind = paidAddonKindInput;
    const normalizedKey = `${rawName.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}`;
    if (
      menuItems.some(
        (item) => `${item.name.trim().toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}` === normalizedKey,
      )
    ) {
      Alert.alert(t('headline.common.error'), t('error.seller.foods.addonDuplicate'));
      return;
    }
    const next: SellerMenuAddon = {
      name: rawName,
      kind,
      pricing,
    };
    const parsed = parseLocalizedDecimal(paidAddonPriceInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert(t('headline.common.error'), t('error.seller.foods.addonPriceRequired'));
      return;
    }
    next.price = Number(parsed.toFixed(2));
    setMenuItems((prev) => [...prev, next]);
    setPaidAddonNameInput("");
    setPaidAddonPriceInput("");
  }

  function removeMenuItem(index: number) {
    setMenuItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

function openAddonLibrary(pricing: AddonPricing, kind: AddonKind) {
    if (pricing === "free") setFreeAddonKindInput("extra");
    else setPaidAddonKindInput(kind);
    setAddonLibraryPricing(pricing);
    setAddonLibraryKind(pricing === "free" ? "extra" : kind);
    setAddonLibraryVisible(true);
  }

  function addAddonFromLibrary(item: SellerMenuAddon) {
    const normalizedKey = `${item.name.toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}|${Number(item.price ?? 0)}`;
    const exists = menuItems.some(
      (entry) => `${entry.name.toLocaleLowerCase("tr-TR")}|${entry.kind}|${entry.pricing}|${Number(entry.price ?? 0)}` === normalizedKey,
    );
    if (exists) {
      Alert.alert(t('status.seller.foods.addonExistsTitle'), t('status.seller.foods.addonExistsBody'));
      return;
    }
    setMenuItems((prev) => [...prev, item]);
    setAddonLibraryVisible(false);
  }

  async function toggleStatus(food: SellerFood) {
    try {
      const res = await authedFetch(`/v1/seller/foods/${food.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !food.isActive }),
      });
      const json = await parseResponseBodySafe(res);
      if (!res.ok) throw new Error(resolveApiMessage(json, "Durum değiştirilemedi"));
      await loadFoods();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foods.statusUpdate'));
    }
  }

  function toDisplayDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  const pickerMonthLabel = useMemo(() => {
    const months = [
      "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
      "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
    ];
    return `${months[pickerMonth.getMonth()]} ${pickerMonth.getFullYear()}`;
  }, [pickerMonth]);

  const pickerDays = useMemo(() => {
    const year = pickerMonth.getFullYear();
    const month = pickerMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayBasedOffset = (firstDay.getDay() + 6) % 7;
    const cells: Array<{ key: string; value?: number }> = [];
    for (let i = 0; i < mondayBasedOffset; i += 1) {
      cells.push({ key: `empty-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ key: `day-${day}`, value: day });
    }
    return cells;
  }, [pickerMonth]);

  const todayDayInPickerMonth = useMemo(() => {
    const now = new Date();
    if (
      now.getFullYear() !== pickerMonth.getFullYear() ||
      now.getMonth() !== pickerMonth.getMonth()
    ) {
      return null;
    }
    return now.getDate();
  }, [pickerMonth]);

  function openDatePicker(target: "start" | "end") {
    const now = new Date();
    const currentValue = target === "start" ? startDate : endDate;
    let baseDate = now;
    if (currentValue.trim()) {
      const parsedIso = parseDisplayDateToIso(currentValue);
      if (parsedIso) baseDate = new Date(parsedIso);
    } else {
      const todayDisplay = toDisplayDate(now);
      if (target === "start") setStartDate(todayDisplay);
      if (target === "end") setEndDate(todayDisplay);
    }
    setPickerMonth(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
    setDatePickerVisible(target);
  }

  function selectDate(day: number) {
    const selected = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), day);
    const value = toDisplayDate(selected);
    if (datePickerVisible === "start") setStartDate(value);
    if (datePickerVisible === "end") setEndDate(value);
    setDatePickerVisible(null);
  }

  const previewImage = imageUrls.map((x) => x.trim()).find(Boolean) || "";
  const selectedCategoryName = categories.find((item) => item.id === categoryId)?.name ?? "";
  const previewTitle = name.trim() || "Yemek Adı";
  const previewStockLine = (() => {
    const stock = Number.parseInt(dailyStock.trim() || "0", 10);
    if (Number.isFinite(stock) && stock > 0) return `${stock} porsiyon kaldı`;
    return "Stok girilmedi";
  })();
  const parsedPreviewPrice = parseLocalizedDecimal(price);
  const previewPrice = Number.isFinite(parsedPreviewPrice) && parsedPreviewPrice > 0 ? `${parsedPreviewPrice.toFixed(2)} ₺` : "-- ₺";
  const previewSellerHandle = useMemo(() => {
    const emailLocal = String(currentAuth.email ?? "").split("@")[0]?.trim();
    const normalized = (emailLocal || "ev.usta")
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9._]/g, "");
    return normalized.startsWith("@") ? normalized : `@${normalized}`;
  }, [currentAuth.email]);
  const previewCuisine = cuisine.trim()
    ? (/(mutfağı|mutfagi)$/i.test(cuisine.trim()) ? cuisine.trim() : `${cuisine.trim()} Mutfağı`)
    : "Ev Mutfağı";
  const previewMeta = prepTime.trim() ? `${prepTime.trim()} dk` : "40 dk";
  const previewMetaText = previewMeta;
  const previewAllergens = allergens
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const paidMenuItems = menuItems.filter((item) => item.pricing === "paid");
  const addonLibraryItems = useMemo(() => {
    const merged: SellerMenuAddon[] = [];
    const pushItem = (raw: SellerMenuAddon) => {
      const key = `${raw.name.toLocaleLowerCase("tr-TR")}|${raw.kind}|${raw.pricing}|${Number(raw.price ?? 0)}`;
      const exists = merged.some(
        (item) => `${item.name.toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}|${Number(item.price ?? 0)}` === key,
      );
      if (!exists) merged.push(raw);
    };
    for (const food of foods) {
      for (const raw of food.menuItems ?? []) {
        const name = String(raw?.name ?? "").trim();
        if (!name) continue;
        const kind: AddonKind = raw?.kind === "sauce" || raw?.kind === "appetizer" ? raw.kind : "extra";
        const pricing: AddonPricing = raw?.pricing === "paid" ? "paid" : "free";
        const price = Number(raw?.price);
        if (pricing === "paid") {
          if (!Number.isFinite(price) || price <= 0) continue;
          pushItem({ name, kind, pricing, price: Number(price.toFixed(2)) });
        } else {
          pushItem({ name, kind, pricing: "free" });
        }
      }
    }
    return merged
      .filter((item) => item.pricing === addonLibraryPricing && (addonLibraryPricing === "free" || item.kind === addonLibraryKind))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [foods, addonLibraryKind, addonLibraryPricing]);
  const screenTitle = editingFood || pendingInitialEditId ? t('headline.seller.foods.titleEdit') : t('headline.seller.foods.titleAdd');

  return (
    <View style={styles.container}>
      <ScreenHeader title={screenTitle} onBack={onBack} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {pendingInitialEditId && !editingFood ? (
          <View style={styles.hydrationWrap}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.hydrationText}>{t('status.seller.foods.preparingEdit')}</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.page}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
          <Text style={styles.sectionTitle}>{t('headline.seller.foods.photos')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {imageUrls.map((url, index) => (
              <View key={`photo-${index}`} style={styles.photoTileWrap}>
                <TouchableOpacity
                  style={[
                    styles.photoPreviewBtn,
                    movingImageIndex === index && styles.photoPreviewBtnMoving,
                  ]}
                  onLongPress={() => {
                    if (!url.trim()) return;
                    // Prevent the trailing onPress from cancelling move mode on the same tile.
                    longPressConsumedIndexRef.current = index;
                    setMovingImageIndex(index);
                  }}
                  delayLongPress={600}
                  onPress={() => {
                    if (longPressConsumedIndexRef.current === index) {
                      longPressConsumedIndexRef.current = null;
                      return;
                    }
                    if (movingImageIndex !== null) {
                      const targetHasImage = Boolean(imageUrls[index]?.trim());
                      if (movingImageIndex !== index && targetHasImage) {
                        moveImage(movingImageIndex, index);
                        return;
                      }
                      setMovingImageIndex(null);
                    }
                    void pickImageFromAlbum(index);
                  }}
                >
                  {url.trim() ? (
                    <Image source={{ uri: url }} style={styles.photoPreviewImage} />
                  ) : (
                    <View style={styles.photoPreviewPlaceholder}>
                      <Text style={styles.photoPreviewIcon}>📸</Text>
                      <Text style={styles.photoPreviewText}>{t('cta.seller.foods.addPhoto')}</Text>
                      <Text style={styles.photoPreviewSub}>{t('helper.seller.foods.photoHint')}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.sectionTitle}>{t('headline.seller.foods.name')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('helper.seller.foods.namePlaceholder')}
            placeholderTextColor={PLACEHOLDER_COLOR}
          />

          <View style={styles.row2}>
            <View style={styles.rowItem}>
              <View style={styles.rowLabelWrap}>
                <Text style={styles.sectionTitle}>{t('headline.seller.foods.cuisine')}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={cuisine}
                onChangeText={setCuisine}
                placeholder={t('helper.seller.foods.cuisinePlaceholder')}
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
            </View>
            <View style={styles.rowItem}>
              <View style={styles.rowLabelWrap}>
                <Text style={styles.sectionTitle}>{t('headline.seller.foods.category')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.input, styles.dropdownInput]}
                onPress={() => {
                  if (!loadingCategories && categories.length === 0) {
                    void loadCategories();
                  }
                  setCategoryModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Text style={selectedCategoryName ? styles.dropdownValue : styles.dropdownPlaceholder}>
                  {selectedCategoryName || t('helper.seller.foods.categoryPlaceholder')}
                </Text>
                <Ionicons name="chevron-down-outline" size={18} color="#7A6B5D" />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t('headline.seller.foods.sideItems')}</Text>
          <TextInput
            style={styles.input}
            value={freeAddonNameInput}
            onChangeText={setFreeAddonNameInput}
            placeholder={t('helper.seller.foods.sideItemsPlaceholder')}
            placeholderTextColor={PLACEHOLDER_COLOR}
            returnKeyType="done"
          />

          <Text style={styles.sectionTitle}>{t('headline.seller.foods.ingredients')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={(value) => setDescription((prev) => normalizeIngredientTyping(prev, value))}
            placeholder={t('helper.seller.foods.ingredientsPlaceholder')}
            placeholderTextColor={PLACEHOLDER_COLOR}
            multiline
          />

          <Text style={styles.sectionTitle}>{t('headline.seller.foods.recipe')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={recipe}
            onChangeText={setRecipe}
            placeholder={t('helper.seller.foods.recipePlaceholder')}
            placeholderTextColor={PLACEHOLDER_COLOR}
            multiline
          />

          <Text style={styles.sectionTitle}>{t('headline.seller.foods.paidAddons')}</Text>
          <View style={styles.kindRow}>
            {ADDON_KIND_OPTIONS.map((option) => (
              <TouchableOpacity
                key={`paid-kind-${option.value}`}
                style={[styles.kindChip, paidAddonKindInput === option.value && styles.kindChipActive]}
                onPress={() => openAddonLibrary("paid", option.value)}
                activeOpacity={0.85}
              >
                <Text style={[styles.kindChipText, paidAddonKindInput === option.value && styles.kindChipTextActive]}>
                  {t(option.label as any)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row2}>
            <TextInput
              style={[styles.input, styles.rowItem]}
              value={paidAddonNameInput}
              onChangeText={setPaidAddonNameInput}
              placeholder={t('helper.seller.foods.productNamePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
            />
            <TextInput
              style={[styles.input, styles.rowItem]}
              value={paidAddonPriceInput}
              onChangeText={setPaidAddonPriceInput}
              placeholder={t('helper.seller.foods.pricePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity style={styles.addMenuItemBtn} onPress={addAddon} activeOpacity={0.85}>
            <Text style={styles.addMenuItemBtnText}>{t('cta.seller.foods.add')}</Text>
          </TouchableOpacity>
          <View style={styles.menuItemsWrap}>
            {paidMenuItems.map((item, index) => {
              const absoluteIndex = menuItems.findIndex(
                (entry) => entry.name === item.name && entry.kind === item.kind && entry.pricing === item.pricing && entry.price === item.price,
              );
              return (
                <View key={`paid-${item.name}-${index}`} style={styles.menuItemChip}>
                  <Text style={styles.menuItemChipText}>
                    {item.name} · {Number(item.price ?? 0).toFixed(2)} ₺
                  </Text>
                  <TouchableOpacity onPress={() => removeMenuItem(absoluteIndex)} hitSlop={8}>
                    <Ionicons name="close" size={16} color="#2F241C" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>{t('headline.seller.foods.allergens')}</Text>
          <TextInput
            style={styles.input}
            value={allergens}
            onChangeText={setAllergens}
            placeholder={t('helper.seller.foods.allergensPlaceholder')}
            placeholderTextColor={PLACEHOLDER_COLOR}
          />

          <View style={styles.row2}>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>{t('headline.seller.foods.price')}</Text>
              <TextInput
                style={styles.input}
                value={price}
                onChangeText={setPrice}
                placeholder="25"
                placeholderTextColor={PLACEHOLDER_COLOR}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>{t('headline.seller.foods.dailyStock')}</Text>
              <TextInput
                style={styles.input}
                value={dailyStock}
                onChangeText={setDailyStock}
                placeholder={t('helper.seller.foods.dailyStockPlaceholder')}
                placeholderTextColor={PLACEHOLDER_COLOR}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.rowItem}>
            <Text style={styles.sectionTitle}>{t('headline.seller.foods.prepTime')}</Text>
            <TextInput
              style={styles.input}
              value={prepTime}
              onChangeText={setPrepTime}
              placeholder={t('helper.seller.foods.prepTimePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.row2}>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>{t('headline.seller.foods.startDate')}</Text>
              <View style={styles.dateInputWrap}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={startDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  editable={false}
                />
                <TouchableOpacity style={styles.dateIconBtn} onPress={() => openDatePicker("start")}>
                  <Ionicons name="calendar-outline" size={18} color="#7A6B5D" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.sectionTitle}>{t('headline.seller.foods.endDate')}</Text>
              <View style={styles.dateInputWrap}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={endDate}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  editable={false}
                />
                <TouchableOpacity style={styles.dateIconBtn} onPress={() => openDatePicker("end")}>
                  <Ionicons name="calendar-outline" size={18} color="#7A6B5D" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.previewBtn} onPress={() => setPreviewVisible(true)}>
            <Text style={styles.previewBtnText}>👁️ {t('cta.seller.foods.preview')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={() => void saveFood({ publishAfterSave: true })}
            disabled={saving}
          >
            <Text style={styles.saveText}>
              {saving
                ? t('status.seller.foods.publishing')
                : editingFood
                  ? t('cta.seller.foods.publishEdit')
                  : t('cta.seller.foods.publishNew')}
            </Text>
          </TouchableOpacity>

          {editingFood ? (
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
              <Text style={styles.cancelText}>{t('cta.seller.foods.clearEdit')}</Text>
            </TouchableOpacity>
          ) : null}

          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setPreviewVisible(false)} />
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>{t('headline.seller.foods.customerPreview')}</Text>
            <View style={styles.previewFoodCard}>
              {previewImage ? (
                <Image source={{ uri: previewImage }} style={styles.previewImage} />
              ) : (
                <View style={styles.previewImagePlaceholder}>
                  <Text style={styles.previewImagePlaceholderText}>{t('headline.seller.foods.previewPhoto')}</Text>
                </View>
              )}
              <TouchableOpacity style={styles.previewLikeBtn} activeOpacity={0.9}>
                <Ionicons name="heart-outline" size={16} color="#2E241C" />
              </TouchableOpacity>
              <View style={styles.previewPriceChip}>
                <Text style={styles.previewPriceChipText}>{previewPrice}</Text>
              </View>
              <View style={styles.previewRatingChip}>
                <Text style={styles.previewRatingChipText}>⭐ 5.0</Text>
              </View>
              <View style={styles.previewBody}>
                <View style={styles.previewTopRow}>
                  <View style={styles.previewTopRowLeft}>
                    <Text style={styles.previewFoodTitle} numberOfLines={1}>{previewTitle}</Text>
                    <Text style={styles.previewFoodSummary} numberOfLines={1}>{previewStockLine}</Text>
                  </View>
                  <View style={styles.previewTopRowRight}>
                    <Text style={styles.previewSeller}>{previewSellerHandle} ›</Text>
                    <Text style={styles.previewCuisine}>{previewCuisine}</Text>
                  </View>
                </View>
                <View style={styles.previewMidRow}>
                  <Ionicons name="time-outline" size={13} color="#8A7A6A" />
                  <Text style={styles.previewMetaText}>{previewMetaText}</Text>
                </View>
                <View style={styles.previewFooter}>
                  <Text style={styles.previewFooterPlaceholder} />
                  {previewAllergens ? <Text style={styles.previewAllergen}>{formatCopy('label.seller.foods.allergenPrefix', { value: previewAllergens })}</Text> : null}
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.previewCloseBtn} onPress={() => setPreviewVisible(false)}>
              <Text style={styles.previewCloseBtnText}>{t('cta.seller.foods.keepEditing')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(datePickerVisible)} transparent animationType="fade" onRequestClose={() => setDatePickerVisible(null)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setDatePickerVisible(null)} />
          <View style={styles.datePickerCard}>
            <View style={styles.datePickerHead}>
              <TouchableOpacity onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={20} color="#2E241C" />
              </TouchableOpacity>
              <Text style={styles.datePickerTitle}>{pickerMonthLabel}</Text>
              <TouchableOpacity onPress={() => setPickerMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={20} color="#2E241C" />
              </TouchableOpacity>
            </View>
            <View style={styles.dateWeekRow}>
              {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((label) => (
                <Text key={label} style={styles.dateWeekLabel}>{label}</Text>
              ))}
            </View>
            <View style={styles.dateGrid}>
              {pickerDays.map((cell) => (
                <TouchableOpacity
                  key={cell.key}
                  style={[
                    styles.dateCell,
                    !cell.value && styles.dateCellEmpty,
                    cell.value && todayDayInPickerMonth === cell.value ? styles.dateCellToday : null,
                  ]}
                  disabled={!cell.value}
                  onPress={() => cell.value && selectDate(cell.value)}
                >
                  <Text
                    style={[
                      styles.dateCellText,
                      !cell.value && styles.dateCellTextEmpty,
                      cell.value && todayDayInPickerMonth === cell.value ? styles.dateCellTextToday : null,
                    ]}
                  >
                    {cell.value ?? ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addonLibraryVisible} transparent animationType="fade" onRequestClose={() => setAddonLibraryVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setAddonLibraryVisible(false)} />
          <View style={styles.categoryModalCard}>
            <Text style={styles.categoryModalTitle}>
              {addonLibraryPricing === "free"
                ? t('headline.seller.foods.freeAddons')
                : formatCopy('headline.seller.foods.paidAddonGroup', { group: t((ADDON_KIND_OPTIONS.find((item) => item.value === addonLibraryKind)?.label ?? "label.seller.foods.kindExtra") as any) })}
            </Text>
            {addonLibraryItems.length === 0 ? (
              <View style={styles.categoryEmptyWrap}>
                <Text style={styles.categoryEmptyText}>{t('helper.seller.foods.emptyAddonGroup')}</Text>
                <TouchableOpacity
                  style={styles.categoryRetryBtn}
                  onPress={() => {
                    setAddonLibraryVisible(false);
                    if (addonLibraryPricing === "free") {
                      setFreeAddonKindInput(addonLibraryKind);
                    } else {
                      setPaidAddonKindInput(addonLibraryKind);
                    }
                  }}
                >
                  <Text style={styles.categoryRetryBtnText}>{t('cta.seller.foods.addNewAddon')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.categoryList} contentContainerStyle={styles.categoryListContent}>
                {addonLibraryItems.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.name}-${index}`}
                    style={styles.categoryOption}
                    onPress={() => addAddonFromLibrary(item)}
                  >
                    <Text style={styles.categoryOptionText}>
                      {item.name}
                      {item.pricing === "paid" ? ` · ${Number(item.price ?? 0).toFixed(2)} ₺` : ""}
                    </Text>
                    <Ionicons name="add-circle-outline" size={18} color="#2E6B44" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={categoryModalVisible} transparent animationType="fade" onRequestClose={() => setCategoryModalVisible(false)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setCategoryModalVisible(false)} />
          <View style={styles.categoryModalCard}>
            <Text style={styles.categoryModalTitle}>{t('headline.seller.foods.selectCategory')}</Text>
            {loadingCategories ? (
              <ActivityIndicator size="small" color={theme.primary} style={{ marginVertical: 12 }} />
            ) : categories.length === 0 ? (
              <View style={styles.categoryEmptyWrap}>
                <Text style={styles.categoryEmptyText}>{t('helper.seller.foods.categoryMissing')}</Text>
                <TouchableOpacity
                  style={styles.categoryRetryBtn}
                  onPress={() => void loadCategories()}
                >
                  <Text style={styles.categoryRetryBtnText}>{t('cta.seller.foods.refresh')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.categoryList} contentContainerStyle={styles.categoryListContent}>
                {categories.map((item) => {
                  const selectedCategoryForTarget = categoryId;
                  const isSelected = selectedCategoryForTarget === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.categoryOption, isSelected && styles.categoryOptionActive]}
                      onPress={() => {
                        setCategoryId(item.id);
                        setCategoryModalVisible(false);
                      }}
                    >
                      <Text style={[styles.categoryOptionText, isSelected && styles.categoryOptionTextActive]}>
                        {item.name}
                      </Text>
                      {isSelected ? <Ionicons name="checkmark-circle" size={18} color="#2E6B44" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  hydrationWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  hydrationText: {
    color: "#5E5144",
    fontWeight: "600",
  },
  page: { flex: 1 },
  content: { padding: 14, paddingBottom: 42 },
  sectionTitle: { color: "#2E241C", fontWeight: "700", marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#2E241C",
  },
  dropdownInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownPlaceholder: { color: "#8A7A6A" },
  dropdownValue: { color: "#2E241C", fontWeight: "600" },
  freeAddonInputWrap: { position: "relative" },
  freeAddonInput: { paddingRight: 44 },
  freeAddonInlineAddBtn: {
    position: "absolute",
    right: 10,
    top: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#79BA94",
    backgroundColor: "#BFDFCF",
    alignItems: "center",
    justifyContent: "center",
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  kindChip: {
    borderWidth: 1,
    borderColor: "#DCD2C2",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#fff",
  },
  kindChipActive: {
    borderColor: "#3F855C",
    backgroundColor: "#EAF4EC",
  },
  kindChipText: { color: "#5C4D3F", fontSize: 12, fontWeight: "700" },
  kindChipTextActive: { color: "#2E6B44" },
  addMenuItemBtn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
    alignItems: "center",
    paddingVertical: 10,
  },
  addMenuItemBtnText: { color: "#3F855C", fontWeight: "800" },
  menuItemsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  menuItemChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 999,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  menuItemChipText: { color: "#2F241C", fontSize: 12, fontWeight: "600" },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  row2: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  rowLabelWrap: { minHeight: 28, justifyContent: "flex-end" },
  row3: { flexDirection: "row", gap: 8 },
  row3Item: { flex: 1 },
  dateInputWrap: { position: "relative" },
  dateInput: { paddingRight: 38 },
  dateIconBtn: {
    position: "absolute",
    right: 10,
    top: 10,
  },
  photoStrip: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
  photoTileWrap: { alignItems: "center", gap: 6 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  photoPreviewBtn: {
    width: 92,
    height: 92,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#F4EEE4",
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreviewBtnMoving: {
    borderColor: "#3F855C",
    borderWidth: 2,
  },
  photoPreviewImage: { width: "100%", height: "100%" },
  photoPreviewPlaceholder: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  photoPreviewIcon: { fontSize: 16 },
  photoPreviewText: { fontSize: 11, color: "#4B4137", fontWeight: "700", marginTop: 2, textAlign: "center" },
  photoPreviewSub: { fontSize: 9, color: "#8A7A6A", marginTop: 2, textAlign: "center" },
  photoInput: { flex: 1 },
  photoAddBtn: {
    marginTop: 4,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "#D8CCBA",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  photoAddText: { color: "#3F855C", fontWeight: "700" },
  photoRemoveBtn: {
    borderWidth: 1,
    borderColor: "#E4D7C5",
    backgroundColor: "#F7EFE2",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  photoRemoveText: { color: "#7A4A2A", fontWeight: "700" },
  deliveryToggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#DCD2C2",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  deliveryToggleActive: {
    backgroundColor: "#BFDFCF",
    borderColor: "#79BA94",
  },
  deliveryToggleText: { color: "#473C31", fontWeight: "700" },
  deliveryToggleTextActive: { color: "#1D5634" },
  optionHint: { color: "#75685C", fontSize: 12, marginTop: 6 },
  subHint: { color: "#75685C", fontSize: 12, marginTop: 6 },
  previewBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  previewBtnText: { color: "#46392D", fontWeight: "700" },
  saveBtn: {
    marginTop: 10,
    backgroundColor: "#3F855C",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
  btnDisabled: { opacity: 0.7 },
  cancelBtn: {
    marginTop: 8,
    backgroundColor: "#EFE7DA",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: { color: "#4A3D31", fontWeight: "700" },
  listHeaderRow: { marginTop: 18, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listHeader: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  newFoodLink: { color: "#3F855C", fontWeight: "700" },
  emptyText: { color: "#75685C", paddingVertical: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10 },
  foodName: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6F6358", marginTop: 4 },
  actionsRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  ghostBtn: { backgroundColor: "#F4EEE4", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "center",
    padding: 16,
  },
  previewCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  previewTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16, marginBottom: 10 },
  previewFoodCard: {
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FDFBF8",
    position: "relative",
  },
  previewImage: { width: "100%", height: 170, backgroundColor: "#EDE5D8" },
  previewImagePlaceholder: {
    width: "100%",
    height: 170,
    backgroundColor: "#EFE7DA",
    alignItems: "center",
    justifyContent: "center",
  },
  previewLikeBtn: {
    position: "absolute",
    left: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewPriceChip: {
    position: "absolute",
    right: 10,
    top: 10,
    borderRadius: 999,
    backgroundColor: "rgba(35,28,22,0.82)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewPriceChipText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  previewRatingChip: {
    position: "absolute",
    right: 10,
    top: 42,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewRatingChipText: { color: "#4A3D31", fontSize: 12, fontWeight: "800" },
  previewImagePlaceholderText: { color: "#77695B", fontWeight: "600" },
  previewBody: { padding: 12 },
  previewTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  previewTopRowLeft: { flex: 1, minWidth: 0 },
  previewTopRowRight: { alignItems: "flex-end", maxWidth: "50%" },
  previewFoodTitle: { color: "#2E241C", fontWeight: "800", fontSize: 18 },
  previewFoodSummary: { color: "#6F6358", marginTop: 2, fontSize: 14, fontWeight: "600" },
  previewSeller: { color: "#5A4B3F", fontWeight: "700", fontSize: 16 },
  previewCuisine: { color: "#7D6D60", fontWeight: "700", fontSize: 14, marginTop: 2 },
  previewDeliveryTypeText: { marginTop: 8, color: "#5A4B3F", fontWeight: "700", fontSize: 13 },
  previewMidRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 5 },
  previewMetaText: { color: "#7D6D60", fontWeight: "600", fontSize: 13 },
  previewFooter: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  previewFooterPlaceholder: { color: "transparent" },
  previewAllergen: { color: "#B73D35", fontWeight: "700", fontSize: 13, flex: 1, textAlign: "right" },
  previewCloseBtn: {
    marginTop: 12,
    backgroundColor: "#3F855C",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  previewCloseBtnText: { color: "#fff", fontWeight: "700" },
  datePickerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  categoryModalCard: {
    maxHeight: "70%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
  },
  categoryModalTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16, marginBottom: 10 },
  categoryEmptyWrap: { alignItems: "center", paddingVertical: 18, gap: 10 },
  categoryEmptyText: { color: "#6F6358", fontSize: 13 },
  categoryRetryBtn: {
    backgroundColor: "#3F855C",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryRetryBtnText: { color: "#fff", fontWeight: "700" },
  categoryList: { maxHeight: 360 },
  categoryListContent: { paddingBottom: 6 },
  categoryOption: {
    borderWidth: 1,
    borderColor: "#E5DDCF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
  },
  categoryOptionActive: {
    borderColor: "#8FA58F",
    backgroundColor: "#ECF4EE",
  },
  categoryOptionText: { color: "#2E241C" },
  categoryOptionTextActive: { color: "#2E6B44", fontWeight: "700" },
  datePickerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  datePickerTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  dateWeekRow: { flexDirection: "row", marginBottom: 6 },
  dateWeekLabel: { flex: 1, textAlign: "center", color: "#7A6B5D", fontSize: 12, fontWeight: "700" },
  dateGrid: { flexDirection: "row", flexWrap: "wrap" },
  dateCell: {
    width: "14.285%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  dateCellToday: {
    borderWidth: 1.5,
    borderColor: "#4A7C59",
    backgroundColor: "#ECF4EE",
  },
  dateCellEmpty: { opacity: 0 },
  dateCellText: { color: "#2E241C", fontWeight: "600" },
  dateCellTextToday: { color: "#2E6B44", fontWeight: "800" },
  dateCellTextEmpty: { color: "transparent" },
});
