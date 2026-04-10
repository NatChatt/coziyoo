import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, FlatList, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { getCurrentLanguage, loadSettings } from "../utils/settings";
import { clearSellerFoodsCache } from "../utils/sellerFoodsCache";
import { addIngredientToLibrary, loadIngredientLibrary } from "../utils/ingredientsLibrary";
import { type AddonTemplate, addCustomAddon, loadAddonLibrary } from "../utils/addonLibrary";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import { formatCopy, t } from "../copy/brandCopy";

const SELLER_FORM_PERSIST_KEY_PREFIX = "seller_food_form_fields_v1";

function IngredientChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 120,
      friction: 8,
    }).start();
  }, []);

  function handleRemove() {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(onRemove);
  }

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
          { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
        ],
      }}
    >
      <TouchableOpacity style={chipStyles.chip} onPress={handleRemove}>
        <Text style={chipStyles.chipText}>{label}</Text>
        <Ionicons name="close" size={12} color="#2E6B44" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#B8DECA",
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    color: "#2E6B44",
    fontWeight: "600",
  },
});

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

type SellerFoodDraft = {
  name?: string;
  price?: string;
  cardSummary?: string;
  description?: string;
  recipe?: string;
  ingredients?: string[];
  allergens?: string;
  imageUrls?: string[];
  prepTime?: string;
  cuisine?: string;
  categoryId?: string;
  freeAddonNameInput?: string;
  freeAddonKindInput?: AddonKind;
  paidAddonNameInput?: string;
  paidAddonKindInput?: AddonKind;
  paidAddonPriceInput?: string;
  menuItems?: SellerMenuAddon[];
};

type SellerFoodsFieldKey =
  | "name"
  | "cuisine"
  | "category"
  | "sideItems"
  | "ingredients"
  | "recipe"
  | "addons"
  | "allergens"
  | "price"
  | "prepTime";

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

  const ingredientsRaw = Array.isArray(item.ingredients)
    ? item.ingredients
    : Array.isArray(item.ingredients_json)
      ? item.ingredients_json
      : [];

  const allergensRaw = Array.isArray(item.allergens)
    ? item.allergens
    : Array.isArray(item.allergens_json)
      ? item.allergens_json
      : [];

  const menuItemsRaw = Array.isArray(item.menuItems)
    ? item.menuItems
    : Array.isArray(item.menu_items_json)
      ? item.menu_items_json
      : [];

  return {
    id: String(item.id ?? ""),
    categoryId: typeof item.categoryId === "string" ? item.categoryId : (typeof item.category_id === "string" ? item.category_id : null),
    categoryName: typeof item.categoryName === "string"
      ? item.categoryName
      : (typeof item.category_name === "string" ? item.category_name : null),
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
    ingredients: ingredientsRaw.map((v) => String(v ?? "")).filter(Boolean),
    allergens: allergensRaw.map((v) => String(v ?? "")).filter(Boolean),
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

function fallbackHomeCategoryOptions(language: "tr" | "en"): FoodCategoryOption[] {
  const names = language === "en"
    ? ["Soups", "Main Dishes", "Salads", "Meze", "Desserts", "Drinks"]
    : ["Çorbalar", "Ana Yemekler", "Salata", "Meze", "Tatlılar", "İçecekler"];
  return names.map((name) => ({
    id: `home:${name.toLocaleLowerCase("tr-TR").replace(/\s+/g, "-")}`,
    name,
  }));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
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

function withTrailingSlash(path: string): string {
  if (path.endsWith("/")) return path;
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) return `${path}/`;
  return `${path.slice(0, queryIndex)}/${path.slice(queryIndex)}`;
}

function isLegacyLotPublishFailure(res: Response, payload: unknown): boolean {
  if ([404, 501].includes(res.status)) return true;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const rawText = typeof obj.rawText === "string" ? obj.rawText.trim() : "";
    if (rawText.startsWith("<")) return true;
    const message = typeof obj.message === "string" ? obj.message : "";
    if (/not found/i.test(message)) return true;
    const err = obj.error as Record<string, unknown> | undefined;
    const errMessage = typeof err?.message === "string" ? err.message : "";
    if (/not found/i.test(errMessage)) return true;
  }
  return false;
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
  const scrollViewRef = useRef<ScrollView | null>(null);
  const fieldOffsetsRef = useRef<Partial<Record<SellerFoodsFieldKey, number>>>({});
  const nameInputRef = useRef<TextInput | null>(null);
  const cuisineInputRef = useRef<TextInput | null>(null);
  const sideItemsInputRef = useRef<TextInput | null>(null);
  const recipeInputRef = useRef<TextInput | null>(null);
  const allergensInputRef = useRef<TextInput | null>(null);
  const priceInputRef = useRef<TextInput | null>(null);
  const prepTimeInputRef = useRef<TextInput | null>(null);
  const currentLanguage = getCurrentLanguage();
  const locale = currentLanguage === "en" ? "en-GB" : "tr-TR";
  const [apiUrl, setApiUrl] = useState("");
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
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
  const [ingredientLibrary, setIngredientLibrary] = useState<string[]>([]);
  const [ingredientsPickerVisible, setIngredientsPickerVisible] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [newIngredientInput, setNewIngredientInput] = useState("");
  const [inlineIngredientInput, setInlineIngredientInput] = useState("");
  const [allergens, setAllergens] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>(["", "", "", "", ""]);
  const [movingImageIndex, setMovingImageIndex] = useState<number | null>(null);
  const longPressConsumedIndexRef = useRef<number | null>(null);
  const imagePickerOpeningRef = useRef(false);
  const [prepTime, setPrepTime] = useState("");

  // UI parity fields (opsiyonlar)
  const [cuisine, setCuisine] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [menuItems, setMenuItems] = useState<SellerMenuAddon[]>([]);
  const [freeAddonNameInput, setFreeAddonNameInput] = useState("");
  const [freeAddonKindInput, setFreeAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonNameInput, setPaidAddonNameInput] = useState("");
  const [paidAddonKindInput, setPaidAddonKindInput] = useState<AddonKind>("extra");
  const [paidAddonPriceInput, setPaidAddonPriceInput] = useState("");
  const [addonLibraryVisible, setAddonLibraryVisible] = useState(false);
  const [addonLibraryKind, setAddonLibraryKind] = useState<AddonKind>("extra");
  const [addonLibraryPricing, setAddonLibraryPricing] = useState<AddonPricing>("free");
  const [addonLibrary, setAddonLibrary] = useState<AddonTemplate[]>([]);
  const [addonSearch, setAddonSearch] = useState("");
  const [newAddonNameInput, setNewAddonNameInput] = useState("");
  const [newAddonPriceInput, setNewAddonPriceInput] = useState("");
  const [persistentFieldsHydrated, setPersistentFieldsHydrated] = useState(false);
  const suppressNextDraftPersistRef = useRef(false);
  const [pendingInitialEditId, setPendingInitialEditId] = useState<string | null>(
    initialEditFood ? null : (initialEditFoodId ?? null),
  );
  const [requiredFieldHighlight, setRequiredFieldHighlight] = useState<SellerFoodsFieldKey | null>(null);
  const requiredFieldHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formPersistKey = useMemo(
    () => `${SELLER_FORM_PERSIST_KEY_PREFIX}:${currentAuth.userId}`,
    [currentAuth.userId],
  );

  useEffect(() => setCurrentAuth(auth), [auth]);
  useEffect(() => {
    setPendingInitialEditId(initialEditFood ? null : (initialEditFoodId ?? null));
  }, [initialEditFoodId, initialEditFood]);
  // Load correct apiUrl from settings on mount so library effects fire with the right URL.
  useEffect(() => {
    void loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);
  useEffect(() => {
    if (!apiUrl) return;
    void loadIngredientLibrary(apiUrl, currentAuth).then(setIngredientLibrary);
  }, [apiUrl, currentAuth]);
  useEffect(() => {
    if (!apiUrl) return;
    void loadAddonLibrary(apiUrl, currentAuth).then(setAddonLibrary);
  }, [apiUrl, currentAuth]);

  useEffect(() => () => {
    if (requiredFieldHighlightTimeoutRef.current) {
      clearTimeout(requiredFieldHighlightTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setPersistentFieldsHydrated(false);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(formPersistKey);
        if (!active) return;
        if (!raw) return;
        const parsed = JSON.parse(raw) as SellerFoodDraft;
        const hasInitialEditContext = Boolean(initialEditFood || initialEditFoodId);
        if (!hasInitialEditContext) {
          setName(typeof parsed.name === "string" ? parsed.name : "");
          setPrice(typeof parsed.price === "string" ? parsed.price : "");
          setCardSummary(typeof parsed.cardSummary === "string" ? parsed.cardSummary : "");
          setDescription(typeof parsed.description === "string" ? parsed.description : "");
          setRecipe(typeof parsed.recipe === "string" ? parsed.recipe : "");
          setAllergens(typeof parsed.allergens === "string" ? parsed.allergens : "");
          setSelectedIngredients(Array.isArray(parsed.ingredients) ? parsed.ingredients.filter((x) => typeof x === "string") : []);
          const hydratedImageUrls = Array.isArray(parsed.imageUrls)
            ? parsed.imageUrls.map((item) => String(item ?? "").trim()).slice(0, 5)
            : [];
          while (hydratedImageUrls.length < 5) hydratedImageUrls.push("");
          setImageUrls(hydratedImageUrls);
          setPrepTime(typeof parsed.prepTime === "string" ? parsed.prepTime : "");
          setCuisine(typeof parsed.cuisine === "string" ? parsed.cuisine : "");
          setCategoryId(typeof parsed.categoryId === "string" ? parsed.categoryId : "");
          setFreeAddonNameInput(typeof parsed.freeAddonNameInput === "string" ? parsed.freeAddonNameInput : "");
          setFreeAddonKindInput(
            parsed.freeAddonKindInput === "sauce" || parsed.freeAddonKindInput === "appetizer"
              ? parsed.freeAddonKindInput
              : "extra",
          );
          setPaidAddonNameInput(typeof parsed.paidAddonNameInput === "string" ? parsed.paidAddonNameInput : "");
          setPaidAddonKindInput(
            parsed.paidAddonKindInput === "sauce" || parsed.paidAddonKindInput === "appetizer"
              ? parsed.paidAddonKindInput
              : "extra",
          );
          setPaidAddonPriceInput(typeof parsed.paidAddonPriceInput === "string" ? parsed.paidAddonPriceInput : "");
          setMenuItems(
            Array.isArray(parsed.menuItems)
              ? parsed.menuItems.filter((item) => item && typeof item.name === "string" && item.name.trim())
              : [],
          );
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
    if (editingFood || pendingInitialEditId || initialEditFood || initialEditFoodId) return;
    if (suppressNextDraftPersistRef.current) {
      suppressNextDraftPersistRef.current = false;
      return;
    }
    const payload = JSON.stringify({
      name,
      price,
      cardSummary,
      description,
      recipe,
      ingredients: selectedIngredients,
      allergens,
      imageUrls,
      prepTime,
      cuisine,
      categoryId,
      freeAddonNameInput,
      freeAddonKindInput,
      paidAddonNameInput,
      paidAddonKindInput,
      paidAddonPriceInput,
      menuItems,
    } satisfies SellerFoodDraft);
    AsyncStorage.setItem(formPersistKey, payload).catch((error) => {
      console.warn("[seller-foods] failed to persist form fields", error);
    });
  }, [
    persistentFieldsHydrated,
    formPersistKey,
    editingFood,
    pendingInitialEditId,
    initialEditFood,
    initialEditFoodId,
    name,
    price,
    cardSummary,
    description,
    recipe,
    selectedIngredients,
    allergens,
    imageUrls,
    prepTime,
    cuisine,
    categoryId,
    freeAddonNameInput,
    freeAddonKindInput,
    paidAddonNameInput,
    paidAddonKindInput,
    paidAddonPriceInput,
    menuItems,
  ]);

  useLayoutEffect(() => {
    if (!initialEditFood) return;
    openEdit(initialEditFood);
    setPendingInitialEditId(null);
  }, [initialEditFood]);

  function handleFieldLayout(field: SellerFoodsFieldKey, event: LayoutChangeEvent) {
    fieldOffsetsRef.current[field] = event.nativeEvent.layout.y;
  }

  function markRequiredField(field: SellerFoodsFieldKey) {
    setRequiredFieldHighlight(field);
    if (requiredFieldHighlightTimeoutRef.current) {
      clearTimeout(requiredFieldHighlightTimeoutRef.current);
    }
    requiredFieldHighlightTimeoutRef.current = setTimeout(() => {
      setRequiredFieldHighlight((current) => (current === field ? null : current));
    }, 4000);
  }

  function clearRequiredFieldHighlight(field: SellerFoodsFieldKey) {
    setRequiredFieldHighlight((current) => (current === field ? null : current));
  }

  function isRequiredFieldHighlighted(field: SellerFoodsFieldKey): boolean {
    return requiredFieldHighlight === field;
  }

  function navigateToRequiredField(
    field: SellerFoodsFieldKey,
    options?: {
      focusRef?: React.RefObject<TextInput | null>;
      openCategoryModal?: boolean;
      openIngredientsPicker?: boolean;
    },
  ) {
    markRequiredField(field);
    const y = fieldOffsetsRef.current[field] ?? 0;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 18), animated: true });
    if (options?.openCategoryModal) {
      setTimeout(() => {
        if (!loadingCategories && categories.length === 0) {
          void loadCategories();
        }
        setCategoryModalVisible(true);
      }, 220);
      return;
    }
    if (options?.openIngredientsPicker) {
      setTimeout(() => setIngredientsPickerVisible(true), 220);
      return;
    }
    if (options?.focusRef?.current) {
      setTimeout(() => options.focusRef?.current?.focus(), 220);
    }
  }

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const fetchWithSession = async (session: AuthSession): Promise<Response> => {
      const primary = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(session) });
      if (
        primary.status !== 404 &&
        primary.status !== 405 &&
        primary.status !== 301 &&
        primary.status !== 308
      ) {
        return primary;
      }
      const fallbackPath = withTrailingSlash(path);
      if (fallbackPath === path) return primary;
      return fetch(`${baseUrl}${fallbackPath}`, { ...init, headers: makeHeaders(session) });
    };

    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    let res = await fetchWithSession(currentAuth);
    if (res.status !== 401 && res.status !== 403) return res;

    // Another screen may have already refreshed auth; try persisted session first.
    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetchWithSession(persisted);
      if (res.status !== 401 && res.status !== 403) return res;
    }

    const refreshed = await refreshAuthSession(baseUrl, persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetchWithSession(refreshed);
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
      clearSellerFoodsCache();
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
            const row = item as {
              id?: unknown;
              nameTr?: unknown;
              nameEn?: unknown;
              name_tr?: unknown;
              name_en?: unknown;
              name?: unknown;
            };
            const id = typeof row.id === "string" ? row.id : "";
            const nameTr = typeof row.nameTr === "string"
              ? row.nameTr.trim()
              : (typeof row.name_tr === "string" ? row.name_tr.trim() : "");
            const nameEn = typeof row.nameEn === "string"
              ? row.nameEn.trim()
              : (typeof row.name_en === "string" ? row.name_en.trim() : "");
            const fallbackName = typeof row.name === "string" ? row.name.trim() : "";
            return {
              id,
              name: currentLanguage === "en"
                ? nameEn || fallbackName || nameTr
                : nameTr || fallbackName || nameEn,
            };
          })
          .filter((item) => item.id && item.name);

      if (mapped.length > 0) {
        setCategories(mapped);
        return;
      }

      const derivedFromFoods = foods
        .map((food) => ({
          id: String(food.categoryId ?? "").trim(),
          name: String(food.categoryName ?? "").trim(),
        }))
        .filter((item) => item.id && item.name);

      setCategories(derivedFromFoods.length > 0 ? derivedFromFoods : fallbackHomeCategoryOptions(currentLanguage));
    } catch (e) {
      console.warn("[seller-foods] categories load failed:", e);
      const derivedFromFoods = foods
        .map((food) => ({
          id: String(food.categoryId ?? "").trim(),
          name: String(food.categoryName ?? "").trim(),
        }))
        .filter((item) => item.id && item.name);
      setCategories(derivedFromFoods.length > 0 ? derivedFromFoods : fallbackHomeCategoryOptions(currentLanguage));
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
    suppressNextDraftPersistRef.current = true;
    setRequiredFieldHighlight(null);
    setEditingFood(null);
    setName("");
    setPrice("");
    setCardSummary("");
    setDescription("");
    setRecipe("");
    setSelectedIngredients([]);
    setAllergens("");
    setImageUrls(["", "", "", "", ""]);
    setMovingImageIndex(null);
    setPrepTime("");
    setCuisine("");
    setCategoryId("");
    setMenuItems([]);
    setFreeAddonNameInput("");
    setFreeAddonKindInput("extra");
    setPaidAddonNameInput("");
    setPaidAddonKindInput("extra");
    setPaidAddonPriceInput("");
  }

  function openEdit(food: SellerFood) {
    setRequiredFieldHighlight(null);
    setEditingFood(food);
    setName(food.name);
    setPrice(String(food.price));
    setCardSummary(food.cardSummary ?? "");
    setDescription(food.description ?? "");
    setRecipe(food.recipe ?? "");
    setSelectedIngredients(Array.isArray(food.ingredients) ? food.ingredients : []);
    setAllergens(Array.isArray(food.allergens) ? food.allergens.join(", ") : "");
    const seededImageUrls = (food.imageUrls?.length ? food.imageUrls : [food.imageUrl ?? ""]).slice(0, 5);
    while (seededImageUrls.length < 5) seededImageUrls.push("");
    setImageUrls(seededImageUrls);
    setMovingImageIndex(null);
    setPrepTime(food.preparationTimeMinutes ? String(food.preparationTimeMinutes) : "");
    setCuisine(food.cuisine ?? "");
    setCategoryId(food.categoryId ?? "");
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
      const parsedAllergens = allergens
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!name.trim()) {
        navigateToRequiredField("name", { focusRef: nameInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.nameRequired'));
        return;
      }
      if (!isUuid(categoryId)) {
        navigateToRequiredField("category", { openCategoryModal: true });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.categoryRequired'));
        return;
      }
      if (!cuisine.trim()) {
        navigateToRequiredField("cuisine", { focusRef: cuisineInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.cuisineRequired'));
        return;
      }
      if (selectedIngredients.length === 0) {
        navigateToRequiredField("ingredients", { openIngredientsPicker: true });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.ingredientsRequired'));
        return;
      }
      if (!recipe.trim()) {
        navigateToRequiredField("recipe", { focusRef: recipeInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.recipeRequired'));
        return;
      }
      if (parsedAllergens.length === 0) {
        navigateToRequiredField("allergens", { focusRef: allergensInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.allergensRequired'));
        return;
      }
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        navigateToRequiredField("price", { focusRef: priceInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.priceRequired'));
        return;
      }
      if (!Number.isFinite(parsedPrepTime) || parsedPrepTime <= 0) {
        navigateToRequiredField("prepTime", { focusRef: prepTimeInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.prepRequired'));
        return;
      }
      if (workingMenuItems.length < 1) {
        navigateToRequiredField("sideItems", { focusRef: sideItemsInputRef });
        Alert.alert(t('headline.common.error'), t('error.seller.foods.addonsRequired'));
        return;
      }

      setSaving(true);

      const primaryImageUrl = imageUrls.map((x) => x.trim()).find(Boolean) || undefined;
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
        ingredients: selectedIngredients,
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
      if (!res.ok) throw new Error(resolveApiMessage(json, t('error.seller.foods.save')));
      const responsePayload = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};
      const responseData = (responsePayload.data && typeof responsePayload.data === "object")
        ? (responsePayload.data as Record<string, unknown>)
        : null;

      const foodId = editingFood?.id
        ?? (typeof responseData?.foodId === "string" ? responseData.foodId : null)
        ?? (typeof responseData?.id === "string" ? responseData.id : null);

      if (options?.publishAfterSave && foodId) {
        const saleStartsAt = new Date().toISOString();
        const fallbackEnd = new Date(saleStartsAt);
        fallbackEnd.setUTCDate(fallbackEnd.getUTCDate() + 30);
        const saleEndsAt = fallbackEnd.toISOString();
        const producedAt = saleStartsAt;
        const quantityProduced = 1;
        const statusRes = await authedFetch(`/v1/seller/foods/${foodId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: true }),
        });
        if (!statusRes.ok) {
          const statusJson = await parseResponseBodySafe(statusRes);
          throw new Error(resolveApiMessage(statusJson, t('error.seller.foods.statusUpdate')));
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
          let existingLotId: string | null = null;
          hasVisibleLot = lots.some((lot: any) => {
            const lotFoodId = String(lot?.food_id ?? lot?.foodId ?? "").trim();
            const status = String(lot?.status ?? "").toLowerCase();
            const qty = Number(lot?.quantity_available ?? lot?.quantityAvailable ?? 0);
            const startsAt = Date.parse(String(lot?.sale_starts_at ?? lot?.saleStartsAt ?? ""));
            const endsAt = Date.parse(String(lot?.sale_ends_at ?? lot?.saleEndsAt ?? ""));
            if (
              lotFoodId === foodId &&
              (status === "active" || status === "open") &&
              qty > 0 &&
              Number.isFinite(startsAt) &&
              Number.isFinite(endsAt) &&
              startsAt <= now &&
              endsAt > now
            ) {
              existingLotId = String(lot?.id ?? lot?.lotId ?? "");
              return true;
            }
            return false;
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
            if (isLegacyLotPublishFailure(lotRes, lotJson)) {
              console.warn("[seller-foods] legacy publish fallback without lot creation", {
                status: lotRes.status,
                foodId,
                response: lotJson,
              });
            } else {
              throw new Error(resolveApiMessage(lotJson, t('error.seller.foods.lotCreate')));
            }
          }
        }
      }

      await loadFoods();
      clearSellerFoodsCache();
      if (options?.publishAfterSave) {
        Alert.alert(
          t('status.seller.foods.publishedTitle'),
          editingFood ? t('status.seller.foods.publishedBodyEdit') : t('status.seller.foods.publishedBodyNew'),
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

  function addAddonFromLibrary(item: AddonTemplate) {
    const menuItem: SellerMenuAddon = {
      name: item.name,
      kind: item.kind,
      pricing: item.pricing,
      ...(item.pricing === "paid" && item.defaultPrice ? { price: item.defaultPrice } : {}),
    };
    const normalizedKey = `${menuItem.name.toLocaleLowerCase("tr-TR")}|${menuItem.kind}|${menuItem.pricing}|${Number(menuItem.price ?? 0)}`;
    const exists = menuItems.some(
      (entry) => `${entry.name.toLocaleLowerCase("tr-TR")}|${entry.kind}|${entry.pricing}|${Number(entry.price ?? 0)}` === normalizedKey,
    );
    if (exists) {
      Alert.alert(t('status.seller.foods.addonExistsTitle'), t('status.seller.foods.addonExistsBody'));
      return;
    }
    setMenuItems((prev) => [...prev, menuItem]);
    setAddonLibraryVisible(false);
    setAddonSearch("");
  }

  async function toggleStatus(food: SellerFood) {
    try {
      const res = await authedFetch(`/v1/seller/foods/${food.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !food.isActive }),
      });
      const json = await parseResponseBodySafe(res);
      if (!res.ok) throw new Error(resolveApiMessage(json, t('error.seller.foods.statusUpdate')));
      await loadFoods();
    } catch (e) {
      Alert.alert(t('headline.common.error'), e instanceof Error ? e.message : t('error.seller.foods.statusUpdate'));
    }
  }


  const previewImage = imageUrls.map((x) => x.trim()).find(Boolean) || "";
  const selectedCategoryName = categories.find((item) => item.id === categoryId)?.name ?? "";
  const previewTitle = name.trim() || t('headline.seller.foods.previewNameFallback');
  const filteredIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLocaleLowerCase("tr-TR");
    return ingredientLibrary.filter((x) => {
      if (selectedIngredients.includes(x)) return false;
      return !q || x.toLocaleLowerCase("tr-TR").includes(q);
    });
  }, [ingredientLibrary, ingredientSearch, selectedIngredients]);

  const parsedPreviewPrice = parseLocalizedDecimal(price);
  const previewPrice = Number.isFinite(parsedPreviewPrice) && parsedPreviewPrice > 0 ? `${parsedPreviewPrice.toFixed(2)} ₺` : "-- ₺";
  const previewSellerHandle = useMemo(() => {
    const emailLocal = String(currentAuth.email ?? "").split("@")[0]?.trim();
    const normalized = (emailLocal || t('helper.seller.foods.previewHandleFallback'))
      .toLocaleLowerCase(locale)
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9._]/g, "");
    return normalized.startsWith("@") ? normalized : `@${normalized}`;
  }, [currentAuth.email, locale]);
  const previewCuisine = cuisine.trim()
    ? (/(mutfağı|mutfagi|cuisine)$/i.test(cuisine.trim()) ? cuisine.trim() : `${cuisine.trim()}${currentLanguage === "en" ? " Cuisine" : " Mutfağı"}`)
    : t('status.seller.foods.defaultCuisine');
  const previewMeta = prepTime.trim() ? `${prepTime.trim()} ${t('label.seller.foods.minutesShort')}` : `40 ${t('label.seller.foods.minutesShort')}`;
  const previewMetaText = previewMeta;
  const previewAllergens = allergens
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const paidMenuItems = menuItems.filter((item) => item.pricing === "paid");
  const addonLibraryItems = useMemo(() => {
    const q = addonSearch.trim().toLocaleLowerCase("tr-TR");
    return addonLibrary
      .filter((item) => {
        if (item.pricing !== addonLibraryPricing) return false;
        if (addonLibraryPricing === "paid" && item.kind !== addonLibraryKind) return false;
        if (q && !item.name.toLocaleLowerCase("tr-TR").includes(q)) return false;
        return true;
      });
  }, [addonLibrary, addonLibraryPricing, addonLibraryKind, addonSearch]);
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
            ref={scrollViewRef}
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
          <View onLayout={(event) => handleFieldLayout("name", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("name") && styles.sectionTitleError]}>{t('headline.seller.foods.name')}</Text>
            <TextInput
              ref={nameInputRef}
              style={[styles.input, isRequiredFieldHighlighted("name") && styles.inputError]}
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (value.trim()) clearRequiredFieldHighlight("name");
              }}
              placeholder={t('helper.seller.foods.namePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
            />
          </View>

          <View style={styles.row2}>
            <View style={styles.rowItem} onLayout={(event) => handleFieldLayout("cuisine", event)}>
              <View style={styles.rowLabelWrap}>
                <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("cuisine") && styles.sectionTitleError]}>{t('headline.seller.foods.cuisine')}</Text>
              </View>
              <TextInput
                ref={cuisineInputRef}
                style={[styles.input, isRequiredFieldHighlighted("cuisine") && styles.inputError]}
                value={cuisine}
                onChangeText={(value) => {
                  setCuisine(value);
                  if (value.trim()) clearRequiredFieldHighlight("cuisine");
                }}
                placeholder={t('helper.seller.foods.cuisinePlaceholder')}
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
            </View>
            <View style={styles.rowItem} onLayout={(event) => handleFieldLayout("category", event)}>
              <View style={styles.rowLabelWrap}>
                <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("category") && styles.sectionTitleError]}>{t('headline.seller.foods.category')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.input, styles.dropdownInput, isRequiredFieldHighlighted("category") && styles.inputError]}
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

          <View onLayout={(event) => handleFieldLayout("sideItems", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("sideItems") && styles.sectionTitleError]}>{t('headline.seller.foods.sideItems')}</Text>
            <TextInput
              ref={sideItemsInputRef}
              style={[styles.input, isRequiredFieldHighlighted("sideItems") && styles.inputError]}
              value={freeAddonNameInput}
              onChangeText={(value) => {
                setFreeAddonNameInput(value);
                if (parseFreeAddonNames(value).length > 0) clearRequiredFieldHighlight("sideItems");
              }}
              placeholder={t('helper.seller.foods.sideItemsPlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              returnKeyType="done"
            />
          </View>

          <View onLayout={(event) => handleFieldLayout("ingredients", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("ingredients") && styles.sectionTitleError]}>{t('headline.seller.foods.ingredients')}</Text>
            {selectedIngredients.length === 0 ? (
              <View>
                <TouchableOpacity
                  style={[styles.input, styles.ingredientsPickerBtn, isRequiredFieldHighlighted("ingredients") && styles.inputError]}
                  onPress={() => { setIngredientsPickerVisible(true); clearRequiredFieldHighlight("ingredients"); }}
                >
                  <Text style={styles.ingredientsPickerPlaceholder}>{t('helper.seller.foods.ingredientsPickerPlaceholder')}</Text>
                </TouchableOpacity>
                <View style={styles.inlineIngredientRow}>
                  <TextInput
                    style={styles.inlineIngredientInput}
                    value={inlineIngredientInput}
                    onChangeText={setInlineIngredientInput}
                    placeholder={t('helper.seller.foods.newIngredientPlaceholder')}
                    placeholderTextColor={PLACEHOLDER_COLOR}
                    returnKeyType="done"
                    onSubmitEditing={async () => {
                      const trimmed = inlineIngredientInput.trim();
                      if (!trimmed) return;
                      await addIngredientToLibrary(trimmed);
                      const updated = await loadIngredientLibrary(apiUrl, currentAuth);
                      setIngredientLibrary(updated);
                      setSelectedIngredients((prev) => [...new Set([...prev, trimmed])]);
                      setInlineIngredientInput("");
                      clearRequiredFieldHighlight("ingredients");
                    }}
                  />
                  <TouchableOpacity
                    style={[styles.inlineIngredientAddBtn, !inlineIngredientInput.trim() && styles.btnDisabled]}
                    disabled={!inlineIngredientInput.trim()}
                    onPress={async () => {
                      const trimmed = inlineIngredientInput.trim();
                      if (!trimmed) return;
                      await addIngredientToLibrary(trimmed);
                      const updated = await loadIngredientLibrary(apiUrl, currentAuth);
                      setIngredientLibrary(updated);
                      setSelectedIngredients((prev) => [...new Set([...prev, trimmed])]);
                      setInlineIngredientInput("");
                      clearRequiredFieldHighlight("ingredients");
                    }}
                  >
                    <Ionicons name="add" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
              <View style={styles.ingredientChipsWrap}>
                {selectedIngredients.map((ing) => (
                  <TouchableOpacity
                    key={ing}
                    style={styles.ingredientChip}
                    onPress={() => setSelectedIngredients((prev) => prev.filter((x) => x !== ing))}
                  >
                    <Text style={styles.ingredientChipText}>{ing}</Text>
                    <Ionicons name="close-circle" size={13} color="#6C5F54" style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.ingredientAddChip} onPress={() => setIngredientsPickerVisible(true)}>
                  <Text style={styles.ingredientAddChipText}>+ {t('cta.seller.foods.editIngredients')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.inlineIngredientRow}>
                <TextInput
                  style={styles.inlineIngredientInput}
                  value={inlineIngredientInput}
                  onChangeText={setInlineIngredientInput}
                  placeholder={t('helper.seller.foods.newIngredientPlaceholder')}
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  returnKeyType="done"
                  onSubmitEditing={async () => {
                    const trimmed = inlineIngredientInput.trim();
                    if (!trimmed) return;
                    await addIngredientToLibrary(trimmed);
                    const updated = await loadIngredientLibrary(apiUrl, currentAuth);
                    setIngredientLibrary(updated);
                    setSelectedIngredients((prev) => [...new Set([...prev, trimmed])]);
                    setInlineIngredientInput("");
                    clearRequiredFieldHighlight("ingredients");
                  }}
                />
                <TouchableOpacity
                  style={[styles.inlineIngredientAddBtn, !inlineIngredientInput.trim() && styles.btnDisabled]}
                  disabled={!inlineIngredientInput.trim()}
                  onPress={async () => {
                    const trimmed = inlineIngredientInput.trim();
                    if (!trimmed) return;
                    await addIngredientToLibrary(trimmed);
                    const updated = await loadIngredientLibrary(apiUrl, currentAuth);
                    setIngredientLibrary(updated);
                    setSelectedIngredients((prev) => [...new Set([...prev, trimmed])]);
                    setInlineIngredientInput("");
                    clearRequiredFieldHighlight("ingredients");
                  }}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              </View>
            )}
          </View>

          <View onLayout={(event) => handleFieldLayout("recipe", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("recipe") && styles.sectionTitleError]}>{t('headline.seller.foods.recipe')}</Text>
            <TextInput
              ref={recipeInputRef}
              style={[styles.input, styles.textArea, isRequiredFieldHighlighted("recipe") && styles.inputError]}
              value={recipe}
              onChangeText={(value) => {
                setRecipe(value);
                if (value.trim()) clearRequiredFieldHighlight("recipe");
              }}
              placeholder={t('helper.seller.foods.recipePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              multiline
            />
          </View>

          <View onLayout={(event) => handleFieldLayout("addons", event)}>
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
          </View>

          <View onLayout={(event) => handleFieldLayout("allergens", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("allergens") && styles.sectionTitleError]}>{t('headline.seller.foods.allergens')}</Text>
            <TextInput
              ref={allergensInputRef}
              style={[styles.input, isRequiredFieldHighlighted("allergens") && styles.inputError]}
              value={allergens}
              onChangeText={(value) => {
                setAllergens(value);
                if (value.split(",").map((x) => x.trim()).filter(Boolean).length > 0) {
                  clearRequiredFieldHighlight("allergens");
                }
              }}
              placeholder={t('helper.seller.foods.allergensPlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
            />
          </View>

          <View style={styles.rowItem} onLayout={(event) => handleFieldLayout("price", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("price") && styles.sectionTitleError]}>{t('headline.seller.foods.price')}</Text>
            <TextInput
              ref={priceInputRef}
              style={[styles.input, isRequiredFieldHighlighted("price") && styles.inputError]}
              value={price}
              onChangeText={(value) => {
                setPrice(value);
                if (Number.isFinite(parseLocalizedDecimal(value)) && parseLocalizedDecimal(value) > 0) {
                  clearRequiredFieldHighlight("price");
                }
              }}
              placeholder="25"
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.rowItem} onLayout={(event) => handleFieldLayout("prepTime", event)}>
            <Text style={[styles.sectionTitle, isRequiredFieldHighlighted("prepTime") && styles.sectionTitleError]}>{t('headline.seller.foods.prepTime')}</Text>
            <TextInput
              ref={prepTimeInputRef}
              style={[styles.input, isRequiredFieldHighlighted("prepTime") && styles.inputError]}
              value={prepTime}
              onChangeText={(value) => {
                setPrepTime(value);
                const parsedValue = Number.parseInt(value.trim() || "0", 10);
                if (Number.isFinite(parsedValue) && parsedValue > 0) clearRequiredFieldHighlight("prepTime");
              }}
              placeholder={t('helper.seller.foods.prepTimePlaceholder')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              keyboardType="number-pad"
            />
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

      <Modal
        visible={ingredientsPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setIngredientsPickerVisible(false); setIngredientSearch(""); setNewIngredientInput(""); }}
      >
        <View style={styles.previewOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            onPress={() => { setIngredientsPickerVisible(false); setIngredientSearch(""); setNewIngredientInput(""); }}
          />
          <View style={styles.ingredientsModalCard}>
            <Text style={styles.categoryModalTitle}>{t('headline.seller.foods.ingredientsPicker')}</Text>
            <TextInput
              style={styles.ingredientSearchInput}
              value={ingredientSearch}
              onChangeText={setIngredientSearch}
              placeholder={t('helper.seller.foods.ingredientsSearch')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              autoCorrect={false}
            />
            <FlatList
              data={filteredIngredients}
              keyExtractor={(item) => item}
              style={styles.categoryList}
              contentContainerStyle={styles.categoryListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.categoryOption}
                  onPress={() => {
                    setSelectedIngredients((prev) => [...prev, item]);
                    setIngredientSearch("");
                  }}
                >
                  <Text style={styles.categoryOptionText}>{item}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.categoryEmptyWrap}>
                  <Text style={styles.categoryEmptyText}>{t('helper.seller.foods.ingredientsNoMatch')}</Text>
                </View>
              }
            />
            {selectedIngredients.length > 0 && (
              <View style={styles.ingredientBasket}>
                <Text style={styles.ingredientBasketLabel}>
                  {selectedIngredients.length} seçili
                </Text>
                <View style={styles.ingredientBasketChips}>
                  {selectedIngredients.map((item) => (
                    <IngredientChip
                      key={item}
                      label={item}
                      onRemove={() => setSelectedIngredients((prev) => prev.filter((x) => x !== item))}
                    />
                  ))}
                </View>
              </View>
            )}
            <View style={styles.newIngredientRow}>
              <TextInput
                style={styles.newIngredientInput}
                value={newIngredientInput}
                onChangeText={setNewIngredientInput}
                placeholder={t('helper.seller.foods.newIngredientPlaceholder')}
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
              <TouchableOpacity
                style={[styles.newIngredientAddBtn, !newIngredientInput.trim() && styles.btnDisabled]}
                disabled={!newIngredientInput.trim()}
                onPress={async () => {
                  const trimmed = newIngredientInput.trim();
                  if (!trimmed) return;
                  await addIngredientToLibrary(trimmed);
                  const updated = await loadIngredientLibrary(apiUrl, currentAuth);
                  setIngredientLibrary(updated);
                  setSelectedIngredients((prev) => [...new Set([...prev, trimmed])]);
                  setNewIngredientInput("");
                  setIngredientSearch("");
                }}
              >
                <Text style={styles.newIngredientAddBtnText}>{t('cta.seller.foods.addIngredient')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => { setIngredientsPickerVisible(false); setIngredientSearch(""); setNewIngredientInput(""); }}
            >
              <Text style={styles.saveText}>{t('cta.seller.foods.doneIngredients')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addonLibraryVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setAddonLibraryVisible(false); setAddonSearch(""); setNewAddonNameInput(""); setNewAddonPriceInput(""); }}
      >
        <View style={styles.previewOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            onPress={() => { setAddonLibraryVisible(false); setAddonSearch(""); setNewAddonNameInput(""); setNewAddonPriceInput(""); }}
          />
          <View style={styles.ingredientsModalCard}>
            <Text style={styles.categoryModalTitle}>
              {addonLibraryPricing === "free"
                ? t('headline.seller.foods.freeAddons')
                : formatCopy('headline.seller.foods.paidAddonGroup', { group: t((ADDON_KIND_OPTIONS.find((item) => item.value === addonLibraryKind)?.label ?? "label.seller.foods.kindExtra") as any) })}
            </Text>
            <TextInput
              style={styles.ingredientSearchInput}
              value={addonSearch}
              onChangeText={setAddonSearch}
              placeholder={t('helper.seller.foods.addonSearch')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              autoCorrect={false}
            />
            <FlatList
              data={addonLibraryItems}
              keyExtractor={(item) => item.id}
              style={styles.categoryList}
              contentContainerStyle={styles.categoryListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.categoryOption}
                  onPress={() => addAddonFromLibrary(item)}
                >
                  <Text style={styles.categoryOptionText}>
                    {item.name}
                    {item.isCustom ? <Text style={{ color: "#9CA3AF" }}> ✎</Text> : null}
                    {item.pricing === "paid" && item.defaultPrice
                      ? ` · ${item.defaultPrice.toFixed(2)} ₺`
                      : ""}
                  </Text>
                  <Ionicons name="add-circle-outline" size={18} color="#2E6B44" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.categoryEmptyWrap}>
                  <Text style={styles.categoryEmptyText}>{t('helper.seller.foods.emptyAddonGroup')}</Text>
                </View>
              }
            />
            <View style={styles.newIngredientRow}>
              <TextInput
                style={[styles.newIngredientInput, { flex: addonLibraryPricing === "paid" ? 2 : 1 }]}
                value={newAddonNameInput}
                onChangeText={setNewAddonNameInput}
                placeholder={t('helper.seller.foods.newAddonNamePlaceholder')}
                placeholderTextColor={PLACEHOLDER_COLOR}
              />
              {addonLibraryPricing === "paid" ? (
                <TextInput
                  style={[styles.newIngredientInput, { flex: 1 }]}
                  value={newAddonPriceInput}
                  onChangeText={setNewAddonPriceInput}
                  placeholder="₺"
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  keyboardType="decimal-pad"
                />
              ) : null}
              <TouchableOpacity
                style={[styles.newIngredientAddBtn, !newAddonNameInput.trim() && styles.btnDisabled]}
                disabled={!newAddonNameInput.trim()}
                onPress={async () => {
                  const trimmed = newAddonNameInput.trim();
                  if (!trimmed) return;
                  const price = addonLibraryPricing === "paid"
                    ? parseFloat(newAddonPriceInput.replace(",", "."))
                    : undefined;
                  const template: AddonTemplate = {
                    id: `custom_${Date.now()}`,
                    name: trimmed,
                    kind: addonLibraryKind,
                    pricing: addonLibraryPricing,
                    ...(addonLibraryPricing === "paid" && price && Number.isFinite(price) ? { defaultPrice: price } : {}),
                    isCustom: true,
                  };
                  await addCustomAddon(template);
                  const updated = await loadAddonLibrary(apiUrl, currentAuth);
                  setAddonLibrary(updated);
                  addAddonFromLibrary(template);
                  setNewAddonNameInput("");
                  setNewAddonPriceInput("");
                  setAddonSearch("");
                }}
              >
                <Text style={styles.newIngredientAddBtnText}>{t('cta.seller.foods.addIngredient')}</Text>
              </TouchableOpacity>
            </View>
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
                        clearRequiredFieldHighlight("category");
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
  sectionTitleError: { color: "#B42318" },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#2E241C",
  },
  inputError: {
    borderColor: "#E5484D",
    backgroundColor: "#FFF5F5",
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
  ingredientsPickerBtn: {
    minHeight: 44,
    justifyContent: "center",
  },
  ingredientsPickerPlaceholder: { color: "#8A7A6A" },
  ingredientChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: 8,
  },
  ingredientChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF4EE",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#79BA94",
  },
  ingredientChipText: { color: "#1D5634", fontWeight: "600", fontSize: 13 },
  ingredientAddChip: {
    backgroundColor: "#F3ECE5",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#D9C8B4",
  },
  ingredientAddChipText: { color: "#6C5F54", fontWeight: "700", fontSize: 13 },
  inlineIngredientRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: 8,
  },
  inlineIngredientInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#2E241C",
  },
  inlineIngredientAddBtn: {
    backgroundColor: "#2E6B44",
    borderRadius: 8,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  ingredientsModalCard: {
    maxHeight: "80%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    gap: 10,
  },
  ingredientSearchInput: {
    backgroundColor: "#F7F4EF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#2E241C",
  },
  ingredientBasket: {
    backgroundColor: "#F0F8F3",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#B8DECA",
    padding: 10,
    gap: 6,
  },
  ingredientBasketLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2E6B44",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ingredientBasketChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  newIngredientRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  newIngredientInput: {
    flex: 1,
    backgroundColor: "#F7F4EF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#2E241C",
  },
  newIngredientAddBtn: {
    backgroundColor: "#3F855C",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  newIngredientAddBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
