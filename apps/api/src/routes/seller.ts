import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { getSellerOperateGate } from "../services/seller-operability.js";
import { normalizeDeliveryType } from "../utils/delivery-type.js";
const WorkingHourSchema = z.object({
  day: z.string().min(2).max(20),
  open: z.string().min(4).max(10),
  close: z.string().min(4).max(10),
  enabled: z.boolean().optional(),
});

const SellerProfileUpdateSchema = z.object({
  kitchenTitle: z.string().min(3).max(120).optional(),
  kitchenDescription: z.string().min(10).max(1000).optional(),
  kitchenSpecialties: z.array(z.string().min(1).max(80)).max(20).optional(),
  deliveryRadiusKm: z.number().min(0.5).max(50).optional(),
  deliveryEnabled: z.boolean().optional(),
  deliveryTerms: z.string().max(1000).optional(),
  workingHours: z.array(WorkingHourSchema).max(14).optional(),
  submitForReview: z.boolean().optional(),
});

const foodImageUrlSchema = z
  .string()
  .refine(
    (v) => /^https?:\/\//i.test(v) || /^data:/i.test(v),
    { message: "Must be an http(s) or data URL" },
  );

const SellerFoodCreateSchema = z.object({
  name: z.string().min(2).max(120),
  cardSummary: z.string().max(240).optional(),
  description: z.string().max(3000).optional(),
  recipe: z.string().max(5000).optional(),
  ingredients: z.array(z.string().min(1).max(200)).max(60).optional(),
  allergens: z.array(z.string().min(1).max(120)).max(40).optional(),
  cuisine: z.string().min(1).max(120).optional(),
  price: z.number().min(1).max(100000),
  preparationTimeMinutes: z.number().int().min(1).max(1440).optional(),
  imageUrl: foodImageUrlSchema.optional(),
  imageUrls: z.array(foodImageUrlSchema).max(5).optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().uuid().optional(),
  menuItems: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        categoryId: z.string().uuid().optional(),
        kind: z.enum(["sauce", "extra", "appetizer"]).optional(),
        pricing: z.enum(["free", "paid"]).optional(),
        price: z.number().min(0).max(100000).optional(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  secondaryCategoryIds: z.array(z.string().uuid()).max(20).optional(),
});

const SellerFoodUpdateSchema = SellerFoodCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field required" },
);

const SellerFoodStatusSchema = z.object({
  isActive: z.boolean(),
});

const SellerFoodImageSchema = z.object({
  imageUrl: z.string().url().optional(),
  dataBase64: z.string().min(16).optional(),
  contentType: z.string().min(3).max(80).optional(),
}).refine(
  (value) => Boolean(value.imageUrl || value.dataBase64),
  { message: "imageUrl or dataBase64 is required" },
);
const SellerOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(200),
});
const SellerReviewsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const sellerRouter = Router();
sellerRouter.use(requireAuth("app"));

function isSchemaCompatError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return ["42P01", "42703", "42883", "3F000"].includes(code);
}

function ensureSellerRole(req: Request, res: Response): boolean {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "seller") {
    res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Seller role required. For both-role users, set x-actor-role: seller.",
      },
    });
    return false;
  }
  return true;
}

function normalizeImageUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item) || /^data:/i.test(item));
  return values.slice(0, 5);
}

type MenuItemKind = "sauce" | "extra" | "appetizer";
type MenuItemPricing = "free" | "paid";
type MenuItemInput = {
  name: string;
  categoryId?: string;
  kind: MenuItemKind;
  pricing: MenuItemPricing;
  price?: number;
};
type MenuItemView = {
  name: string;
  categoryId?: string;
  categoryName?: string | null;
  kind: MenuItemKind;
  pricing: MenuItemPricing;
  price?: number;
};
type SecondaryCategoryView = { id: string; name: string };

function normalizeMenuItems(input: unknown): MenuItemInput[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const items: MenuItemInput[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = String(row.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const rawKind = String(row.kind ?? "").trim().toLocaleLowerCase("en-US");
    const kind: MenuItemKind = rawKind === "sauce" || rawKind === "appetizer" ? rawKind : "extra";
    const rawPricing = String(row.pricing ?? "").trim().toLocaleLowerCase("en-US");
    const pricing: MenuItemPricing = rawPricing === "paid" ? "paid" : "free";
    const rawPrice = Number(row.price);
    const normalizedPrice = Number.isFinite(rawPrice) ? Number(rawPrice.toFixed(2)) : undefined;
    const dedupeKey = `${name.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const categoryId = typeof row.categoryId === "string" && row.categoryId.trim() ? row.categoryId.trim() : undefined;
    const baseItem: MenuItemInput = {
      name,
      kind,
      pricing,
      ...(categoryId ? { categoryId } : {}),
    };
    if (pricing === "paid" && normalizedPrice !== undefined) {
      items.push({ ...baseItem, price: normalizedPrice });
    } else {
      items.push(baseItem);
    }
  }

  return items.slice(0, 20);
}

function normalizeSecondaryCategoryIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim();
    if (value) unique.add(value);
  }
  return Array.from(unique).slice(0, 20);
}

function resolveSecondaryCategoryIds(input: {
  mainCategoryId?: string | null;
  menuItems?: Array<{ name: string; categoryId?: string }>;
  secondaryCategoryIds?: string[];
}): string[] {
  const unique = new Set<string>();
  const mainCategoryId = input.mainCategoryId?.trim() || null;

  for (const id of input.secondaryCategoryIds ?? []) {
    const value = id.trim();
    if (value && value !== mainCategoryId) unique.add(value);
  }
  for (const item of input.menuItems ?? []) {
    const value = item.categoryId?.trim();
    if (value && value !== mainCategoryId) unique.add(value);
  }

  return Array.from(unique).slice(0, 20);
}

function validateMenuItems(items: MenuItemInput[] | undefined): string | null {
  if (!items) return null;
  if (items.length < 1) return "menuItems must include at least one item";
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.name.trim().toLocaleLowerCase("tr-TR")}|${item.kind}|${item.pricing}`;
    if (!key) return "menuItems contains empty item name";
    if (seen.has(key)) return "menuItems contains duplicate names";
    seen.add(key);
    if (item.pricing === "paid") {
      if (!Number.isFinite(item.price) || Number(item.price) <= 0) {
        return "paid menuItems must include price > 0";
      }
    }
  }
  return null;
}

async function loadCategoryNameMap(categoryIds: string[]): Promise<Map<string, string>> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uniq = Array.from(
    new Set(
      categoryIds
        .map((item) => item.trim())
        .filter((item) => Boolean(item) && uuidPattern.test(item)),
    ),
  );
  if (uniq.length === 0) return new Map<string, string>();

  const result = await pool.query<{ id: string; name_tr: string | null; name_en: string | null }>(
    `SELECT id::text, name_tr, name_en
     FROM categories
     WHERE id = ANY($1::uuid[])`,
    [uniq],
  );

  const map = new Map<string, string>();
  for (const row of result.rows) {
    const label = row.name_tr?.trim() || row.name_en?.trim() || row.id;
    map.set(row.id, label);
  }
  return map;
}

async function hasFoodsMenuColumns(): Promise<boolean> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'foods'
       AND column_name IN ('menu_items_json', 'secondary_category_ids_json')`,
  );
  const names = new Set(result.rows.map((row) => row.column_name));
  return names.has("menu_items_json") && names.has("secondary_category_ids_json");
}

async function getUsersSellerProfileColumns(): Promise<Set<string>> {
  const columns = [
    "username",
    "kitchen_title",
    "kitchen_description",
    "kitchen_specialties",
    "delivery_radius_km",
    "delivery_enabled",
    "delivery_terms",
    "working_hours_json",
    "seller_profile_status",
    "home_card_image_url",
  ];
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = ANY($1::text[])`,
    [columns],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function mapMenuItemsWithCategoryNames(menuItems: unknown, categoryMap: Map<string, string>): MenuItemView[] {
  return normalizeMenuItems(menuItems).map((item) => ({
    name: item.name,
    categoryId: item.categoryId,
    categoryName: item.categoryId ? (categoryMap.get(item.categoryId) ?? null) : null,
    kind: item.kind,
    pricing: item.pricing,
    ...(item.pricing === "paid" && Number.isFinite(item.price) ? { price: Number(item.price) } : {}),
  }));
}

function mapSecondaryCategories(
  idsRaw: unknown,
  categoryMap: Map<string, string>,
): SecondaryCategoryView[] {
  return normalizeSecondaryCategoryIds(idsRaw)
    .map((id) => ({ id, name: categoryMap.get(id) ?? "" }))
    .filter((item) => item.name);
}

function computeSellerProfileStatus(input: {
  profileStatus: "incomplete" | "pending_review" | "active";
  kitchenTitle: string | null;
  kitchenDescription: string | null;
  deliveryRadiusKm: number | null;
  workingHours: unknown;
  phone: string | null;
  hasDefaultAddress: boolean;
  submitForReview: boolean;
}): "incomplete" | "pending_review" | "active" {
  const hasWorkingHours = Array.isArray(input.workingHours) && input.workingHours.length > 0;
  const isComplete = Boolean(
    input.kitchenTitle?.trim() &&
      input.kitchenDescription?.trim() &&
      input.deliveryRadiusKm &&
      hasWorkingHours &&
      input.phone?.trim() &&
      input.hasDefaultAddress,
  );
  if (!isComplete) return "incomplete";
  if (input.profileStatus === "active") return "active";
  if (input.submitForReview) return "pending_review";
  return input.profileStatus === "pending_review" ? "pending_review" : "incomplete";
}

sellerRouter.get("/orders", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const parsed = SellerOrdersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;
  const userId = req.auth!.userId;

  try {
    const [countResult, listResult] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM orders
         WHERE seller_id = $1`,
        [userId],
      ),
      pool.query<{
        id: string;
        buyer_id: string;
        seller_id: string;
        status: string;
        delivery_type: string;
        delivery_address_json: unknown;
        total_price: string;
        created_at: string;
        updated_at: string;
        buyer_name: string | null;
        primary_food_name: string | null;
        item_count: string;
        buyer_progress_status: string | null;
        buyer_progress_at: string | null;
      }>(
        `SELECT
           o.id::text,
           o.buyer_id::text,
           o.seller_id::text,
           o.status,
           o.delivery_type,
           o.delivery_address_json,
           o.total_price::text,
           o.created_at::text,
           o.updated_at::text,
           b.display_name AS buyer_name,
           first_item.food_name AS primary_food_name,
           COALESCE(item_stats.item_count, 0)::text AS item_count,
           buyer_progress.to_status AS buyer_progress_status,
           buyer_progress.created_at::text AS buyer_progress_at
         FROM orders o
         LEFT JOIN users b ON b.id = o.buyer_id
         LEFT JOIN LATERAL (
           SELECT f.name AS food_name
           FROM order_items oi
           LEFT JOIN foods f ON f.id = oi.food_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC
           LIMIT 1
         ) first_item ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS item_count
           FROM order_items oi
           WHERE oi.order_id = o.id
         ) item_stats ON TRUE
         LEFT JOIN LATERAL (
           SELECT oe.to_status, oe.created_at
           FROM order_events oe
           WHERE oe.order_id = o.id
             AND oe.actor_user_id = o.buyer_id
             AND oe.to_status IN ('in_delivery', 'approaching', 'at_door')
           ORDER BY oe.created_at DESC
           LIMIT 1
         ) buyer_progress ON TRUE
         WHERE o.seller_id = $1
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT $2 OFFSET $3`,
        [userId, pageSize, offset],
      ),
    ]);

    const total = Number(countResult.rows[0]?.count ?? "0");
    return res.json({
      data: listResult.rows.map((row) => ({
        id: row.id,
        buyerId: row.buyer_id,
        sellerId: row.seller_id,
        status: row.status,
        deliveryType: normalizeDeliveryType(row.delivery_type) ?? row.delivery_type,
        deliveryAddress: row.delivery_address_json,
        totalPrice: Number(row.total_price),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        buyerName: row.buyer_name ?? null,
        orderNo: `#${row.id.slice(0, 8).toUpperCase()}`,
        primaryFoodName: row.primary_food_name ?? null,
        itemCount: Number(row.item_count ?? "0"),
        buyerProgressStatus: row.buyer_progress_status ?? null,
        buyerProgressAt: row.buyer_progress_at ?? null,
      })),
      pagination: {
        mode: "offset",
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("[seller] orders list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller orders" } });
  }
});

sellerRouter.get("/reviews", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;

  const parsed = SellerReviewsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;
  const userId = req.auth!.userId;

  try {
    const [summaryResult, listResult] = await Promise.all([
      pool.query<{ average_rating: string | null; total_reviews: string }>(
        `SELECT
           ROUND(COALESCE(AVG(r.rating), 0)::numeric, 2)::text AS average_rating,
           COUNT(*)::text AS total_reviews
         FROM reviews r
         WHERE r.seller_id = $1`,
        [userId],
      ),
      pool.query<{
        id: string;
        rating: number;
        comment: string | null;
        created_at: string;
        food_name: string | null;
        buyer_name: string | null;
      }>(
        `SELECT
           r.id::text,
           r.rating,
           r.comment,
           r.created_at::text,
           f.name AS food_name,
           COALESCE(b.display_name, b.username, 'Anonim Kullanıcı') AS buyer_name
         FROM reviews r
         LEFT JOIN foods f ON f.id = r.food_id
         LEFT JOIN users b ON b.id = r.buyer_id
         WHERE r.seller_id = $1
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $2 OFFSET $3`,
        [userId, pageSize, offset],
      ),
    ]);

    const summaryRow = summaryResult.rows[0];
    const total = Number(summaryRow?.total_reviews ?? "0");
    return res.json({
      data: {
        summary: {
          averageRating: Number(summaryRow?.average_rating ?? "0"),
          totalReviews: total,
        },
        items: listResult.rows.map((row) => ({
          id: row.id,
          rating: Number(row.rating ?? 0),
          comment: row.comment ?? "",
          foodName: row.food_name ?? null,
          buyerName: row.buyer_name ?? "Anonim Kullanıcı",
          createdAt: row.created_at,
        })),
      },
      pagination: {
        mode: "offset",
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("[seller] reviews list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller reviews" } });
  }
});

sellerRouter.get("/profile", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const userId = req.auth!.userId;
  try {
    const profileColumns = await getUsersSellerProfileColumns();
    const hasColumn = (columnName: string): boolean => profileColumns.has(columnName);
    const [userResult, addressResult] = await Promise.all([
      pool.query<{
        id: string;
        display_name: string | null;
        username: string | null;
        email: string;
        profile_image_url: string | null;
        home_card_image_url: string | null;
        phone: string | null;
        kitchen_title: string | null;
        kitchen_description: string | null;
        kitchen_specialties: unknown;
        delivery_radius_km: string | null;
        delivery_enabled: boolean;
        delivery_terms: string | null;
        working_hours_json: unknown;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `SELECT
           id,
           display_name,
           ${hasColumn("username") ? "username" : "NULL::text AS username"},
           email,
           profile_image_url,
           ${hasColumn("home_card_image_url") ? "home_card_image_url" : "NULL::text AS home_card_image_url"},
           phone,
           ${hasColumn("kitchen_title") ? "kitchen_title" : "NULL::text AS kitchen_title"},
           ${hasColumn("kitchen_description") ? "kitchen_description" : "NULL::text AS kitchen_description"},
           ${hasColumn("kitchen_specialties") ? "kitchen_specialties" : "'[]'::jsonb AS kitchen_specialties"},
           ${hasColumn("delivery_radius_km") ? "delivery_radius_km::text" : "NULL::text AS delivery_radius_km"},
           ${hasColumn("delivery_enabled") ? "delivery_enabled" : "FALSE AS delivery_enabled"},
           ${hasColumn("delivery_terms") ? "delivery_terms" : "NULL::text AS delivery_terms"},
           ${hasColumn("working_hours_json") ? "working_hours_json" : "'[]'::jsonb AS working_hours_json"},
           ${hasColumn("seller_profile_status") ? "seller_profile_status" : "'incomplete'::text AS seller_profile_status"}
         FROM users
         WHERE id = $1 AND is_active = TRUE`,
        [userId],
      ),
      pool.query<{ id: string; title: string; address_line: string; is_default: boolean }>(
        `SELECT id::text, title, address_line, is_default
         FROM user_addresses
         WHERE user_id = $1
         ORDER BY is_default DESC, updated_at DESC`,
        [userId],
      ),
    ]);

    if ((userResult.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const row = userResult.rows[0];
    const defaultAddress = addressResult.rows.find((addr) => addr.is_default) ?? null;
    const hasDefaultAddress = Boolean(defaultAddress);
    const rawProfileStatus = String(row.seller_profile_status ?? "").trim().toLowerCase();
    const profileStatusSeed: "incomplete" | "pending_review" | "active" =
      rawProfileStatus === "active" || rawProfileStatus === "pending_review" || rawProfileStatus === "incomplete"
        ? (rawProfileStatus as "incomplete" | "pending_review" | "active")
        : "incomplete";
    const profileStatus = computeSellerProfileStatus({
      profileStatus: profileStatusSeed,
      kitchenTitle: row.kitchen_title,
      kitchenDescription: row.kitchen_description,
      deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
      workingHours: row.working_hours_json,
      phone: row.phone,
      hasDefaultAddress,
      submitForReview: false,
    });
    let operateGate = null;
    try {
      operateGate = await getSellerOperateGate(pool, userId);
    } catch (error) {
      if (!isSchemaCompatError(error)) throw error;
      const code = String((error as { code?: unknown } | null)?.code ?? "unknown");
      console.warn("[seller] profile operate gate skipped (schema not ready)", { userId, code });
    }

    return res.json({
      data: {
        sellerId: row.id,
        displayName: row.display_name,
        username: row.username,
        email: row.email,
        profileImageUrl: row.profile_image_url,
        homeCardImageUrl: row.home_card_image_url,
        phone: row.phone,
        kitchenTitle: row.kitchen_title,
        kitchenDescription: row.kitchen_description,
        kitchenSpecialties: Array.isArray(row.kitchen_specialties) ? row.kitchen_specialties : [],
        deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
        deliveryEnabled: Boolean(row.delivery_enabled),
        deliveryTerms: row.delivery_terms,
        workingHours: Array.isArray(row.working_hours_json) ? row.working_hours_json : [],
        status: profileStatus,
        defaultAddress: defaultAddress
          ? { id: defaultAddress.id, title: defaultAddress.title, addressLine: defaultAddress.address_line }
          : null,
        requirements: {
          hasPhone: Boolean(row.phone?.trim()),
          hasDefaultAddress,
          hasKitchenTitle: Boolean(row.kitchen_title?.trim()),
          hasKitchenDescription: Boolean(row.kitchen_description?.trim()),
          hasDeliveryRadius: Boolean(row.delivery_radius_km),
          hasWorkingHours: Array.isArray(row.working_hours_json) && row.working_hours_json.length > 0,
          complianceRequiredCount: operateGate?.complianceRequiredCount ?? 0,
          complianceUploadedRequiredCount: operateGate?.complianceUploadedRequiredCount ?? 0,
          complianceMissingRequiredCount: operateGate?.complianceMissingRequiredCount ?? 0,
          canOperate: operateGate?.canOperate ?? false,
        },
      },
    });
  } catch (error) {
    console.error("[seller] profile get error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller profile" } });
  }
});

sellerRouter.put("/profile", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const parsed = SellerProfileUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;
    const userId = req.auth!.userId;

    try {
      const profileColumns = await getUsersSellerProfileColumns();
      const hasColumn = (columnName: string): boolean => profileColumns.has(columnName);
      const addressResult = await pool.query<{ has_default: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM user_addresses WHERE user_id = $1 AND is_default = TRUE
        ) AS has_default`,
        [userId],
      );
      const hasDefaultAddress = Boolean(addressResult.rows[0]?.has_default);

      const currentResult = await pool.query<{
        kitchen_title: string | null;
        kitchen_description: string | null;
        delivery_radius_km: string | null;
        delivery_enabled: boolean;
        delivery_terms: string | null;
        working_hours_json: unknown;
        phone: string | null;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `SELECT
           ${hasColumn("kitchen_title") ? "kitchen_title" : "NULL::text AS kitchen_title"},
           ${hasColumn("kitchen_description") ? "kitchen_description" : "NULL::text AS kitchen_description"},
           ${hasColumn("delivery_radius_km") ? "delivery_radius_km::text" : "NULL::text AS delivery_radius_km"},
           ${hasColumn("delivery_enabled") ? "delivery_enabled" : "FALSE AS delivery_enabled"},
           ${hasColumn("delivery_terms") ? "delivery_terms" : "NULL::text AS delivery_terms"},
           ${hasColumn("working_hours_json") ? "working_hours_json" : "'[]'::jsonb AS working_hours_json"},
           phone,
           ${hasColumn("seller_profile_status") ? "seller_profile_status" : "'incomplete'::text AS seller_profile_status"}
         FROM users
         WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if ((currentResult.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
      }
      const current = currentResult.rows[0];
      const rawProfileStatus = String(current.seller_profile_status ?? "").trim().toLowerCase();
      const profileStatusSeed: "incomplete" | "pending_review" | "active" =
        rawProfileStatus === "active" || rawProfileStatus === "pending_review" || rawProfileStatus === "incomplete"
          ? (rawProfileStatus as "incomplete" | "pending_review" | "active")
          : "incomplete";

      const kitchenTitle = input.kitchenTitle ?? current.kitchen_title;
      const kitchenDescription = input.kitchenDescription ?? current.kitchen_description;
      const deliveryRadiusKm = input.deliveryRadiusKm ?? (current.delivery_radius_km ? Number(current.delivery_radius_km) : null);
      const workingHours = input.workingHours ?? (Array.isArray(current.working_hours_json) ? current.working_hours_json : []);
      const nextStatus = computeSellerProfileStatus({
        profileStatus: profileStatusSeed,
        kitchenTitle,
        kitchenDescription,
        deliveryRadiusKm,
        workingHours,
        phone: current.phone,
        hasDefaultAddress,
        submitForReview: Boolean(input.submitForReview),
      });

      const updateValues: Array<string | number | boolean | null> = [userId];
      const bind = (value: string | number | boolean | null): string => {
        updateValues.push(value);
        return `$${updateValues.length}`;
      };
      const setClauses: string[] = ["updated_at = now()"];

      if (hasColumn("kitchen_title") && input.kitchenTitle !== undefined) {
        setClauses.push(`kitchen_title = ${bind(input.kitchenTitle)}`);
      }
      if (hasColumn("kitchen_description") && input.kitchenDescription !== undefined) {
        setClauses.push(`kitchen_description = ${bind(input.kitchenDescription)}`);
      }
      if (hasColumn("delivery_radius_km") && input.deliveryRadiusKm !== undefined) {
        setClauses.push(`delivery_radius_km = ${bind(input.deliveryRadiusKm)}::numeric`);
      }
      if (hasColumn("working_hours_json") && input.workingHours !== undefined) {
        setClauses.push(`working_hours_json = ${bind(JSON.stringify(input.workingHours))}::jsonb`);
      }
      if (hasColumn("kitchen_specialties") && input.kitchenSpecialties !== undefined) {
        setClauses.push(`kitchen_specialties = ${bind(JSON.stringify(input.kitchenSpecialties))}::jsonb`);
      }
      if (hasColumn("delivery_enabled") && input.deliveryEnabled !== undefined) {
        setClauses.push(`delivery_enabled = ${bind(input.deliveryEnabled)}::boolean`);
      }
      if (hasColumn("delivery_terms") && input.deliveryTerms !== undefined) {
        setClauses.push(`delivery_terms = ${bind(input.deliveryTerms.trim())}::text`);
      }
      if (hasColumn("seller_profile_status")) {
        setClauses.push(`seller_profile_status = ${bind(nextStatus)}`);
      }

      await pool.query(
        `UPDATE users
         SET ${setClauses.join(", ")}
         WHERE id = $1`,
        updateValues,
      );

      const updatedResult = await pool.query<{
        kitchen_title: string | null;
        kitchen_description: string | null;
        kitchen_specialties: unknown;
        delivery_radius_km: string | null;
        delivery_enabled: boolean;
        delivery_terms: string | null;
        working_hours_json: unknown;
        seller_profile_status: "incomplete" | "pending_review" | "active";
      }>(
        `SELECT
           ${hasColumn("kitchen_title") ? "kitchen_title" : "NULL::text AS kitchen_title"},
           ${hasColumn("kitchen_description") ? "kitchen_description" : "NULL::text AS kitchen_description"},
           ${hasColumn("kitchen_specialties") ? "kitchen_specialties" : "'[]'::jsonb AS kitchen_specialties"},
           ${hasColumn("delivery_radius_km") ? "delivery_radius_km::text" : "NULL::text AS delivery_radius_km"},
           ${hasColumn("delivery_enabled") ? "delivery_enabled" : "FALSE AS delivery_enabled"},
           ${hasColumn("delivery_terms") ? "delivery_terms" : "NULL::text AS delivery_terms"},
           ${hasColumn("working_hours_json") ? "working_hours_json" : "'[]'::jsonb AS working_hours_json"},
           ${hasColumn("seller_profile_status") ? "seller_profile_status" : `'${nextStatus}'::text AS seller_profile_status`}
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );
      if ((updatedResult.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
      }
      const updated = updatedResult.rows[0];

      return res.json({
        data: {
          kitchenTitle: updated.kitchen_title,
          kitchenDescription: updated.kitchen_description,
          kitchenSpecialties: Array.isArray(updated.kitchen_specialties) ? updated.kitchen_specialties : [],
          deliveryRadiusKm: updated.delivery_radius_km ? Number(updated.delivery_radius_km) : null,
          deliveryEnabled: Boolean(updated.delivery_enabled),
          deliveryTerms: updated.delivery_terms,
          workingHours: Array.isArray(updated.working_hours_json) ? updated.working_hours_json : [],
          status: updated.seller_profile_status,
        },
      });
    } catch (error) {
      console.error("[seller] profile update error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update seller profile" } });
    }
});

sellerRouter.get("/foods", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const userId = req.auth!.userId;
  try {
    const menuColumnsEnabled = await hasFoodsMenuColumns();
    const result = await pool.query(
      `SELECT
         f.id::text,
         f.category_id::text AS category_id,
         c.name_tr AS category_name,
         f.name,
         f.card_summary,
         f.description,
         f.recipe,
         f.cuisine,
         ${menuColumnsEnabled ? "f.menu_items_json, f.secondary_category_ids_json," : "'[]'::jsonb AS menu_items_json, '[]'::jsonb AS secondary_category_ids_json,"}
         f.price::text,
         f.image_url,
         f.image_urls_json,
         f.ingredients_json,
         f.allergens_json,
         f.preparation_time_minutes,
         f.is_active,
         f.created_at::text,
         f.updated_at::text,
         COALESCE((
           SELECT SUM(pl.quantity_available)::int
           FROM production_lots pl
           WHERE pl.food_id = f.id
             AND pl.status IN ('open', 'active')
             AND pl.quantity_available > 0
             AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= now())
             AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > now())
         ), 0)::int AS stock
       FROM foods f
       LEFT JOIN categories c ON c.id = f.category_id
       WHERE f.seller_id = $1
       ORDER BY f.updated_at DESC`,
      [userId],
    );
    const categoryIds = new Set<string>();
    for (const row of result.rows) {
      if (typeof row.category_id === "string" && row.category_id) categoryIds.add(row.category_id);
      for (const item of normalizeMenuItems((row as { menu_items_json?: unknown }).menu_items_json)) {
        if (item.categoryId) categoryIds.add(item.categoryId);
      }
      for (const id of normalizeSecondaryCategoryIds((row as { secondary_category_ids_json?: unknown }).secondary_category_ids_json)) {
        categoryIds.add(id);
      }
    }
    let categoryMap = new Map<string, string>();
    try {
      categoryMap = await loadCategoryNameMap(Array.from(categoryIds));
    } catch (categoryError) {
      console.warn("[seller] foods list category map failed; continuing without category labels", {
        userId,
        categoryCount: categoryIds.size,
        error: categoryError instanceof Error ? categoryError.message : String(categoryError),
      });
    }

    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id ?? null,
        categoryName: row.category_name ?? null,
        name: row.name,
        cardSummary: row.card_summary,
        description: row.description,
        recipe: row.recipe,
        cuisine: row.cuisine ?? null,
        menuItems: mapMenuItemsWithCategoryNames((row as { menu_items_json?: unknown }).menu_items_json, categoryMap),
        secondaryCategories: mapSecondaryCategories((row as { secondary_category_ids_json?: unknown }).secondary_category_ids_json, categoryMap),
        price: Number(row.price),
        imageUrl: row.image_url,
        imageUrls: normalizeImageUrls(row.image_urls_json),
        ingredients: Array.isArray(row.ingredients_json) ? row.ingredients_json : [],
        allergens: Array.isArray(row.allergens_json) ? row.allergens_json : [],
        preparationTimeMinutes: row.preparation_time_minutes,
        isActive: Boolean(row.is_active),
        stock: Number(row.stock ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("[seller] foods list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list foods" } });
  }
});

sellerRouter.get("/categories", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  try {
    const result = await pool.query<{
      id: string;
      name_tr: string | null;
      name_en: string | null;
    }>(
      `SELECT id::text, name_tr, name_en
       FROM categories
       WHERE is_active = true
       ORDER BY sort_order ASC NULLS LAST, name_tr ASC, name_en ASC`,
    );

    if (result.rows.length > 0) {
      return res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          nameTr: row.name_tr,
          nameEn: row.name_en,
        })),
      });
    }

    // Fallback: derive distinct categories from existing foods (same source as home screen)
    const fallback = await pool.query<{ id: string; name_tr: string }>(
      `SELECT DISTINCT c.id::text, c.name_tr
       FROM categories c
       JOIN foods f ON f.category_id = c.id
       WHERE f.is_active = true
       ORDER BY c.name_tr ASC`,
    );

    return res.json({
      data: fallback.rows.map((row) => ({
        id: row.id,
        nameTr: row.name_tr,
        nameEn: null,
      })),
    });
  } catch (error) {
    console.error("[seller] categories list error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list categories" } });
  }
});

sellerRouter.post("/foods", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const parsed = SellerFoodCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;
    const normalizedMenuItems = normalizeMenuItems(input.menuItems);
    const menuValidationError = validateMenuItems(normalizedMenuItems);
    if (menuValidationError) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: menuValidationError } });
    }
    const resolvedSecondaryCategoryIds = resolveSecondaryCategoryIds({
      mainCategoryId: input.categoryId ?? null,
      menuItems: normalizedMenuItems,
      secondaryCategoryIds: normalizeSecondaryCategoryIds(input.secondaryCategoryIds),
    });
    try {
      const menuColumnsEnabled = await hasFoodsMenuColumns();
      const created = menuColumnsEnabled
        ? await pool.query<{ id: string }>(
          `INSERT INTO foods
             (seller_id, category_id, name, card_summary, description, recipe, cuisine, menu_items_json, secondary_category_ids_json, price, image_url, image_urls_json, ingredients_json, allergens_json, preparation_time_minutes, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, now(), now())
           RETURNING id::text`,
          [
            req.auth!.userId,
            input.categoryId ?? null,
            input.name.trim(),
            input.cardSummary?.trim() ?? null,
            input.description?.trim() ?? null,
            input.recipe?.trim() ?? null,
            input.cuisine?.trim() ?? null,
            JSON.stringify(normalizedMenuItems),
            JSON.stringify(resolvedSecondaryCategoryIds),
            input.price,
            input.imageUrls?.[0] ?? input.imageUrl ?? null,
            JSON.stringify((input.imageUrls ?? (input.imageUrl ? [input.imageUrl] : [])).slice(0, 5)),
            JSON.stringify(input.ingredients ?? []),
            JSON.stringify(input.allergens ?? []),
            input.preparationTimeMinutes ?? null,
            input.isActive ?? true,
          ],
        )
        : await pool.query<{ id: string }>(
          `INSERT INTO foods
             (seller_id, category_id, name, card_summary, description, recipe, cuisine, price, image_url, image_urls_json, ingredients_json, allergens_json, preparation_time_minutes, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, now(), now())
           RETURNING id::text`,
          [
            req.auth!.userId,
            input.categoryId ?? null,
            input.name.trim(),
            input.cardSummary?.trim() ?? null,
            input.description?.trim() ?? null,
            input.recipe?.trim() ?? null,
            input.cuisine?.trim() ?? null,
            input.price,
            input.imageUrls?.[0] ?? input.imageUrl ?? null,
            JSON.stringify((input.imageUrls ?? (input.imageUrl ? [input.imageUrl] : [])).slice(0, 5)),
            JSON.stringify(input.ingredients ?? []),
            JSON.stringify(input.allergens ?? []),
            input.preparationTimeMinutes ?? null,
            input.isActive ?? true,
          ],
        );
      return res.status(201).json({ data: { foodId: created.rows[0].id } });
    } catch (error) {
      console.error("[seller] food create error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create food" } });
    }
});

sellerRouter.patch("/foods/:foodId", async (req, res) => {
    if (!ensureSellerRole(req, res)) return;
    const foodId = String(req.params.foodId ?? "");
    if (!z.string().uuid().safeParse(foodId).success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
    }
    const parsed = SellerFoodUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }
    const input = parsed.data;
    const normalizedMenuItems = input.menuItems !== undefined ? normalizeMenuItems(input.menuItems) : undefined;
    const menuValidationError = validateMenuItems(normalizedMenuItems);
    if (menuValidationError) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: menuValidationError } });
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.categoryId !== undefined) {
      setClauses.push(`category_id = $${idx++}`);
      values.push(input.categoryId ?? null);
    }
    if (input.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(input.name.trim());
    }
    if (input.cardSummary !== undefined) {
      setClauses.push(`card_summary = $${idx++}`);
      values.push(input.cardSummary?.trim() ?? null);
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${idx++}`);
      values.push(input.description?.trim() ?? null);
    }
    if (input.recipe !== undefined) {
      setClauses.push(`recipe = $${idx++}`);
      values.push(input.recipe?.trim() ?? null);
    }
    if (input.cuisine !== undefined) {
      setClauses.push(`cuisine = $${idx++}`);
      values.push(input.cuisine?.trim() ?? null);
    }
    const menuColumnsEnabled = await hasFoodsMenuColumns();
    if (normalizedMenuItems !== undefined && menuColumnsEnabled) {
      setClauses.push(`menu_items_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(normalizedMenuItems));
    }
    if (menuColumnsEnabled && (input.secondaryCategoryIds !== undefined || normalizedMenuItems !== undefined || input.categoryId !== undefined)) {
      const existingResult = await pool.query<{ category_id: string | null; menu_items_json: unknown; secondary_category_ids_json: unknown }>(
        `SELECT category_id::text, menu_items_json, secondary_category_ids_json
         FROM foods
         WHERE id = $1 AND seller_id = $2`,
        [foodId, req.auth!.userId],
      );
      if ((existingResult.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
      }
      const existing = existingResult.rows[0];
      const nextMainCategoryId = input.categoryId !== undefined ? (input.categoryId ?? null) : existing.category_id;
      const nextMenuItems = normalizedMenuItems ?? normalizeMenuItems(existing.menu_items_json);
      const secondaryInput = input.secondaryCategoryIds !== undefined
        ? normalizeSecondaryCategoryIds(input.secondaryCategoryIds)
        : normalizeSecondaryCategoryIds(existing.secondary_category_ids_json);
      const resolvedSecondaryCategoryIds = resolveSecondaryCategoryIds({
        mainCategoryId: nextMainCategoryId,
        menuItems: nextMenuItems,
        secondaryCategoryIds: secondaryInput,
      });
      setClauses.push(`secondary_category_ids_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(resolvedSecondaryCategoryIds));
    }
    if (input.price !== undefined) {
      setClauses.push(`price = $${idx++}`);
      values.push(input.price);
    }
    if (input.imageUrl !== undefined) {
      setClauses.push(`image_url = $${idx++}`);
      values.push(input.imageUrl ?? null);
      if (input.imageUrls === undefined) {
        setClauses.push(`image_urls_json = CASE
          WHEN $${idx}::text IS NULL OR btrim($${idx}::text) = '' THEN '[]'::jsonb
          WHEN jsonb_typeof(image_urls_json) = 'array' THEN jsonb_set(image_urls_json, '{0}', to_jsonb($${idx}::text), true)
          ELSE jsonb_build_array($${idx}::text)
        END`);
        values.push(input.imageUrl ?? null);
        idx += 1;
      }
    }
    if (input.imageUrls !== undefined) {
      const normalizedImageUrls = (input.imageUrls ?? []).slice(0, 5);
      setClauses.push(`image_urls_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(normalizedImageUrls));
      if (input.imageUrl === undefined) {
        setClauses.push(`image_url = $${idx++}`);
        values.push(normalizedImageUrls[0] ?? null);
      }
    }
    if (input.ingredients !== undefined) {
      setClauses.push(`ingredients_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.ingredients ?? []));
    }
    if (input.allergens !== undefined) {
      setClauses.push(`allergens_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(input.allergens ?? []));
    }
    if (input.preparationTimeMinutes !== undefined) {
      setClauses.push(`preparation_time_minutes = $${idx++}`);
      values.push(input.preparationTimeMinutes ?? null);
    }
    if (input.isActive !== undefined) {
      setClauses.push(`is_active = $${idx++}`);
      values.push(input.isActive);
    }
    setClauses.push(`updated_at = now()`);

    values.push(foodId, req.auth!.userId);
    try {
      const updated = await pool.query<{ id: string }>(
        `UPDATE foods
         SET ${setClauses.join(", ")}
         WHERE id = $${idx++} AND seller_id = $${idx}
         RETURNING id::text`,
        values,
      );
      if ((updated.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
      }
      return res.json({ data: { foodId: updated.rows[0].id } });
    } catch (error) {
      console.error("[seller] food update error:", error);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food" } });
    }
});

sellerRouter.patch("/foods/:foodId/status", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const foodId = String(req.params.foodId ?? "");
  if (!z.string().uuid().safeParse(foodId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
  }
  const parsed = SellerFoodStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  try {
    const updated = await pool.query<{ id: string; is_active: boolean }>(
      `UPDATE foods
       SET is_active = $3, updated_at = now()
       WHERE id = $1 AND seller_id = $2
       RETURNING id::text, is_active`,
      [foodId, req.auth!.userId, parsed.data.isActive],
    );
    if ((updated.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }
    return res.json({ data: { foodId: updated.rows[0].id, isActive: updated.rows[0].is_active } });
  } catch (error) {
    console.error("[seller] food status error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food status" } });
  }
});

sellerRouter.post("/foods/:foodId/image", async (req, res) => {
  if (!ensureSellerRole(req, res)) return;
  const foodId = String(req.params.foodId ?? "");
  if (!z.string().uuid().safeParse(foodId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid food id" } });
  }
  const parsed = SellerFoodImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  const imageUrl = input.imageUrl
    ? input.imageUrl
    : `data:${input.contentType ?? "image/jpeg"};base64,${input.dataBase64 ?? ""}`;

  try {
    const updated = await pool.query<{ id: string; image_url: string | null }>(
      `UPDATE foods
       SET image_url = $3,
           image_urls_json = CASE
             WHEN jsonb_typeof(image_urls_json) = 'array' THEN jsonb_set(
               image_urls_json,
               '{0}',
               to_jsonb($3::text),
               true
             )
             ELSE jsonb_build_array($3::text)
           END,
           updated_at = now()
       WHERE id = $1 AND seller_id = $2
       RETURNING id::text, image_url`,
      [foodId, req.auth!.userId, imageUrl],
    );
    if ((updated.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }
    return res.json({ data: { foodId: updated.rows[0].id, imageUrl: updated.rows[0].image_url } });
  } catch (error) {
    console.error("[seller] food image error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update food image" } });
  }
});

sellerRouter.post("/foods/:foodId/image/presign", async (_req, res) =>
  res.status(501).json({
    error: { code: "NOT_IMPLEMENTED", message: "Presign upload is not enabled yet for seller foods" },
  }));

sellerRouter.get("/directory", async (_req, res) => {
  try {
    const result = await pool.query<{
      id: string;
      display_name: string | null;
      kitchen_title: string | null;
      kitchen_description: string | null;
      delivery_radius_km: string | null;
      seller_profile_status: "incomplete" | "pending_review" | "active";
      created_at: string;
    }>(
      `SELECT id::text, display_name, kitchen_title, kitchen_description,
              delivery_radius_km::text, seller_profile_status, created_at::text
       FROM users
       WHERE user_type IN ('seller', 'both')
         AND is_active = TRUE
       ORDER BY display_name ASC`,
    );
    return res.json({
      data: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        kitchenTitle: row.kitchen_title,
        kitchenDescription: row.kitchen_description,
        deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : null,
        status: row.seller_profile_status ?? "incomplete",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("[seller] directory error:", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load seller directory" } });
  }
});
