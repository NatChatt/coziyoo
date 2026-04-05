import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const foodsRouter = Router();

foodsRouter.use(requireAuth("app"));

function parseAllergens(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function parseImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^https?:\/\//i.test(item) || /^data:/i.test(item))
    .slice(0, 5);
}

function resolvePrimaryFoodImage(imageUrlsValue: unknown, imageUrlFallback: unknown): string | null {
  const imageUrls = parseImageUrls(imageUrlsValue);
  if (imageUrls.length > 0) return imageUrls[0] ?? null;
  const fallback = String(imageUrlFallback ?? "").trim();
  return fallback.length > 0 ? fallback : null;
}

function sellerDeliveryOptions(deliveryEnabledValue: unknown): { pickup: boolean; delivery: boolean } {
  return {
    pickup: true,
    delivery: Boolean(deliveryEnabledValue),
  };
}

type FoodMenuItem = {
  name: string;
  categoryId?: string;
  categoryName?: string | null;
  kind: "sauce" | "extra" | "appetizer";
  pricing: "free" | "paid";
  price?: number;
};
type SecondaryCategory = { id: string; name: string };

function parseMenuItems(value: unknown): Array<{
  name: string;
  categoryId?: string;
  kind: "sauce" | "extra" | "appetizer";
  pricing: "free" | "paid";
  price?: number;
}> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: Array<{
    name: string;
    categoryId?: string;
    kind: "sauce" | "extra" | "appetizer";
    pricing: "free" | "paid";
    price?: number;
  }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = String(row.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const rawKind = String(row.kind ?? "").trim().toLocaleLowerCase("en-US");
    const kind: "sauce" | "extra" | "appetizer" =
      rawKind === "sauce" || rawKind === "appetizer" ? rawKind : "extra";
    const rawPricing = String(row.pricing ?? "").trim().toLocaleLowerCase("en-US");
    const pricing: "free" | "paid" = rawPricing === "paid" ? "paid" : "free";
    const rawPrice = Number(row.price);
    const price = Number.isFinite(rawPrice) ? Number(rawPrice.toFixed(2)) : undefined;
    const key = `${name.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const categoryId = typeof row.categoryId === "string" && row.categoryId.trim() ? row.categoryId.trim() : undefined;
    const base = {
      name,
      kind,
      pricing,
      ...(categoryId ? { categoryId } : {}),
    };
    items.push(pricing === "paid" && price && price > 0 ? { ...base, price } : base);
  }
  return items.slice(0, 20);
}

function parseSecondaryCategoryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const raw of value) {
    const id = String(raw ?? "").trim();
    if (id) unique.add(id);
  }
  return Array.from(unique).slice(0, 20);
}

async function loadCategoryNameMap(categoryIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(categoryIds.map((item) => item.trim()).filter(Boolean)));
  if (ids.length === 0) return new Map<string, string>();

  const result = await pool.query<{ id: string; name_tr: string | null; name_en: string | null }>(
    `SELECT id::text, name_tr, name_en
     FROM categories
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.id, row.name_tr?.trim() || row.name_en?.trim() || row.id);
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

function mapMenuItemsWithNames(value: unknown, categoryMap: Map<string, string>): FoodMenuItem[] {
  return parseMenuItems(value).map((item) => ({
    name: item.name,
    categoryId: item.categoryId,
    categoryName: item.categoryId ? (categoryMap.get(item.categoryId) ?? null) : null,
    kind: item.kind,
    pricing: item.pricing,
    ...(item.pricing === "paid" && Number.isFinite(item.price) ? { price: Number(item.price) } : {}),
  }));
}

function mapSecondaryCategories(value: unknown, categoryMap: Map<string, string>): SecondaryCategory[] {
  return parseSecondaryCategoryIds(value)
    .map((id) => ({ id, name: categoryMap.get(id) ?? "" }))
    .filter((item) => item.name);
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function buildRecommendationReason(input: {
  foodName: string;
  isUntried: boolean;
  isTopSold: boolean;
  userOrderCount: number;
}): string {
  const { foodName, isUntried, isTopSold, userOrderCount } = input;
  const normalized = foodName.trim();

  if (isUntried && isTopSold) {
    return pickRandom([
      `Hep aynı şeyleri yiyorsun, ${normalized}'a ne dersin?`,
      `${normalized} çok satanlarda üstte, bence bir dene.`,
      `${normalized} bayağı tutuluyor, bugün ona gidelim mi?`,
      `Yeni bir şey deneyelim: ${normalized} çok iyi gidiyor.`,
    ]);
  }

  if (isUntried) {
    return pickRandom([
      `${normalized}'ı daha önce denemedin, bugün şans verelim mi?`,
      `Bugün farklı gidelim: ${normalized} nasıl olur?`,
      `${normalized} güzel bir değişiklik olabilir.`,
    ]);
  }

  if (isTopSold) {
    return pickRandom([
      `${normalized} çok satanlardan, yine iyi gider.`,
      `Çok satanlarda ${normalized} var, bir kez daha iyi gider.`,
      `${normalized} yine trendde, kaçırma derim.`,
    ]);
  }

  if (userOrderCount > 0) {
    return pickRandom([
      `${normalized} senden tam not almıştı, tekrar ister misin?`,
      `Bunu sevdiğini biliyorum: ${normalized}.`,
      `${normalized} yine iyi gider gibi duruyor.`,
    ]);
  }

  return pickRandom([
    `Bugün ${normalized} deneyebilirsin.`,
    `${normalized} iyi bir tercih olur.`,
    `${normalized} için içimden iyi bir his geçiyor.`,
  ]);
}

/**
 * GET /v1/foods
 * List active foods with seller info, category, and available lot stock.
 * Query params: category (category name_tr filter)
 */
foodsRouter.get("/", async (req, res) => {
  try {
    const menuColumnsEnabled = await hasFoodsMenuColumns();
    const categoryFilter = req.query.category as string | undefined;

    let query = `
      SELECT
        f.id,
        f.name,
        f.card_summary,
        f.description,
        f.price,
        f.image_url,
        f.image_urls_json,
        f.rating,
        f.review_count,
        f.preparation_time_minutes,
        f.allergens_json,
        f.ingredients_json,
        f.cuisine,
        ${menuColumnsEnabled ? "f.menu_items_json, f.secondary_category_ids_json," : "'[]'::jsonb AS menu_items_json, '[]'::jsonb AS secondary_category_ids_json,"}
        COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
        u.delivery_radius_km AS seller_delivery_radius_km,
        f.category_id::text AS category_id,
        (
          SELECT pl.id
          FROM production_lots pl
          WHERE pl.food_id = f.id
            AND pl.status IN ('open', 'active')
            AND pl.quantity_available > 0
            AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
            AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
          ORDER BY pl.quantity_available DESC, pl.created_at DESC
          LIMIT 1
        ) AS lot_id,
        f.is_active,
        c.name_tr AS category,
        u.id AS seller_id,
        u.display_name AS seller_name,
        u.username AS seller_username,
        u.profile_image_url AS seller_image,
        COALESCE(
          (SELECT SUM(pl.quantity_available)
           FROM production_lots pl
           WHERE pl.food_id = f.id
             AND pl.status IN ('open', 'active')
             AND pl.quantity_available > 0
             AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
             AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
          ), 0
        )::int AS stock
      FROM foods f
      JOIN users u ON u.id = f.seller_id
      LEFT JOIN categories c ON c.id = f.category_id
      WHERE f.is_active = true
        AND EXISTS (
          SELECT 1
          FROM production_lots plx
          WHERE plx.food_id = f.id
            AND plx.status IN ('open', 'active')
            AND plx.quantity_available > 0
            AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
            AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
        )
    `;

    const params: string[] = [];

    if (categoryFilter && categoryFilter !== "Tumu") {
      params.push(categoryFilter);
      query += ` AND c.name_tr = $${params.length}`;
    }

    query += ` ORDER BY f.rating DESC NULLS LAST, f.created_at DESC`;

    const { rows } = await pool.query(query, params);

    const categoryIds = new Set<string>();
    for (const row of rows) {
      if (typeof row.category_id === "string" && row.category_id) categoryIds.add(row.category_id);
      for (const item of parseMenuItems((row as { menu_items_json?: unknown }).menu_items_json)) {
        if (item.categoryId) categoryIds.add(item.categoryId);
      }
      for (const id of parseSecondaryCategoryIds((row as { secondary_category_ids_json?: unknown }).secondary_category_ids_json)) {
        categoryIds.add(id);
      }
    }
    const categoryMap = await loadCategoryNameMap(Array.from(categoryIds));

    const foods = rows.map((r) => ({
      id: r.id,
      name: r.name,
      cardSummary: r.card_summary,
      description: r.description,
      price: parseFloat(r.price),
      deliveryFee: 0,
      deliveryOptions: sellerDeliveryOptions(r.seller_delivery_enabled),
      imageUrl: resolvePrimaryFoodImage(r.image_urls_json, r.image_url),
      imageUrls: parseImageUrls(r.image_urls_json),
      rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
      reviewCount: r.review_count,
      prepTime: r.preparation_time_minutes,
      maxDistance: r.seller_delivery_radius_km
        ? parseFloat(r.seller_delivery_radius_km)
        : null,
      allergens: parseAllergens(r.allergens_json),
      ingredients: parseAllergens(r.ingredients_json),
      cuisine: r.cuisine ?? null,
      menuItems: mapMenuItemsWithNames((r as { menu_items_json?: unknown }).menu_items_json, categoryMap),
      secondaryCategories: mapSecondaryCategories((r as { secondary_category_ids_json?: unknown }).secondary_category_ids_json, categoryMap),
      lotId: r.lot_id ?? null,
      category: r.category,
      stock: Number(r.stock ?? 0),
      seller: {
        id: r.seller_id,
        name: r.seller_name,
        username: r.seller_username,
        image: r.seller_image,
      },
    }));

    res.json({ data: foods });
  } catch (err) {
    console.error("[foods] list error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load foods" },
    });
  }
});

/**
 * GET /v1/foods/top-sold
 * List most sold dishes aggregated across all sellers by dish name.
 * Query params: limit (default 12, max 50)
 */
foodsRouter.get("/top-sold", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "12"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 12;

    const { rows } = await pool.query(
      `
        WITH per_food AS (
          SELECT
            f.id,
            f.name,
            f.image_url,
            f.image_urls_json,
            f.rating,
            f.review_count,
            COALESCE(SUM(oi.quantity), 0)::int AS sold_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN foods f ON f.id = oi.food_id
          WHERE o.payment_completed = TRUE
            AND o.status IN ('paid', 'preparing', 'ready', 'in_delivery', 'at_door', 'delivered', 'completed')
          GROUP BY f.id, f.name, f.image_url, f.image_urls_json, f.rating, f.review_count
        ),
        by_name AS (
          SELECT
            lower(trim(name)) AS name_key,
            MIN(name) AS name,
            SUM(sold_qty)::int AS total_sold
          FROM per_food
          GROUP BY lower(trim(name))
        ),
        top_visual AS (
          SELECT
            lower(trim(name)) AS name_key,
            id AS food_id,
            image_url,
            image_urls_json,
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(name))
              ORDER BY sold_qty DESC, review_count DESC NULLS LAST, rating DESC NULLS LAST, id
            ) AS rn
          FROM per_food
        )
        SELECT
          b.name,
          b.total_sold,
          tv.food_id,
          tv.image_url,
          tv.image_urls_json,
          f.price,
          f.description,
          f.preparation_time_minutes AS prep_time,
          u.delivery_radius_km AS max_distance,
          c.name_tr AS category,
          f.allergens_json AS allergens,
          f.ingredients_json AS ingredients,
          f.cuisine,
          COALESCE(
            (SELECT SUM(pl.quantity_available)
             FROM production_lots pl
             WHERE pl.food_id = f.id
               AND pl.status IN ('open', 'active')
               AND pl.quantity_available > 0
               AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
               AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
            ), 0
          )::int AS stock,
          f.rating,
          f.seller_id,
          u.display_name AS seller_name,
          u.username AS seller_username
        FROM by_name b
        LEFT JOIN top_visual tv
          ON tv.name_key = b.name_key
         AND tv.rn = 1
        LEFT JOIN foods f ON f.id = tv.food_id
        LEFT JOIN categories c ON c.id = f.category_id
        LEFT JOIN users u ON u.id = f.seller_id
        ORDER BY b.total_sold DESC, b.name ASC
        LIMIT $1
      `,
      [limit],
    );

    const data = rows.map((r) => ({
      id: r.food_id ?? `dish-${String(r.name ?? "").toLowerCase()}`,
      name: r.name as string,
      imageUrl: resolvePrimaryFoodImage(r.image_urls_json, r.image_url),
      imageUrls: parseImageUrls(r.image_urls_json),
      totalSold: Number(r.total_sold ?? 0),
      price: r.price != null ? `₺${Number(r.price).toFixed(2)}` : null,
      description: (r.description as string | null) ?? null,
      prepTime: r.prep_time != null ? `${r.prep_time} dk` : null,
      maxDistance: r.max_distance != null ? `${r.max_distance} km` : null,
      category: (r.category as string | null) ?? null,
      allergens: parseAllergens(r.allergens),
      ingredients: parseAllergens(r.ingredients),
      cuisine: (r.cuisine as string | null) ?? null,
      stock: Number(r.stock ?? 0),
      rating: (r.rating as string | null) ?? null,
      sellerId: (r.seller_id as string | null) ?? null,
      sellerName: (r.seller_name as string | null) ?? null,
      sellerUsername: (r.seller_username as string | null) ?? null,
    }));

    res.json({ data });
  } catch (err) {
    console.error("[foods] top sold error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load top sold foods" },
    });
  }
});

/**
 * GET /v1/foods/top-sold/:foodId/nearest
 * Resolve nearest deliverable seller for selected top-sold dish.
 * Query params: lat, lng, basis (optional)
 */
foodsRouter.get("/top-sold/:foodId/nearest", async (req, res) => {
  try {
    const foodId = String(req.params.foodId ?? "").trim();
    const lat = Number.parseFloat(String(req.query.lat ?? ""));
    const lng = Number.parseFloat(String(req.query.lng ?? ""));
    const basisRaw = String(req.query.basis ?? "live_location").trim();
    const basis = basisRaw.length > 0 ? basisRaw : "live_location";

    if (!foodId) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "foodId is required" },
      });
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "lat must be between -90 and 90" },
      });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "lng must be between -180 and 180" },
      });
    }

    const { rows } = await pool.query(
      `
        WITH target_name AS (
          SELECT lower(trim(name)) AS name_key
          FROM foods
          WHERE id = $1
          LIMIT 1
        ),
        available_foods AS (
          SELECT
            f.id,
            f.name,
            f.card_summary,
            f.description,
            f.price,
            f.image_url,
            f.image_urls_json,
            f.rating,
            f.review_count,
            f.preparation_time_minutes,
            u.delivery_radius_km AS max_delivery_distance_km,
            f.allergens_json,
            f.ingredients_json,
            f.cuisine,
            (
              SELECT pl.id
              FROM production_lots pl
              WHERE pl.food_id = f.id
                AND pl.status IN ('open', 'active')
                AND pl.quantity_available > 0
                AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ORDER BY pl.quantity_available DESC, pl.created_at DESC
              LIMIT 1
            ) AS lot_id,
            c.name_tr AS category,
            u.id AS seller_id,
            u.display_name AS seller_name,
            u.username AS seller_username,
            u.profile_image_url AS seller_image,
            u.latitude::float8 AS seller_latitude,
            u.longitude::float8 AS seller_longitude,
            COALESCE(
              (SELECT SUM(pl.quantity_available)
               FROM production_lots pl
               WHERE pl.food_id = f.id
                 AND pl.status IN ('open', 'active')
                 AND pl.quantity_available > 0
                 AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                 AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ), 0
            )::int AS stock
          FROM foods f
          JOIN users u ON u.id = f.seller_id
          LEFT JOIN categories c ON c.id = f.category_id
          WHERE f.is_active = TRUE
            AND COALESCE(u.delivery_enabled, FALSE) = TRUE
            AND EXISTS (
              SELECT 1
              FROM production_lots plx
              WHERE plx.food_id = f.id
                AND plx.status IN ('open', 'active')
                AND plx.quantity_available > 0
                AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
                AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
            )
        ),
        candidates AS (
          SELECT
            af.*,
            (
              6371 * acos(
                LEAST(
                  1,
                  GREATEST(
                    -1,
                    cos(radians($2::float8))
                    * cos(radians(af.seller_latitude))
                    * cos(radians(af.seller_longitude) - radians($3::float8))
                    + sin(radians($2::float8))
                    * sin(radians(af.seller_latitude))
                  )
                )
              )
            ) AS distance_km
          FROM available_foods af
          JOIN target_name tn ON lower(trim(af.name)) = tn.name_key
          WHERE af.seller_latitude IS NOT NULL
            AND af.seller_longitude IS NOT NULL
            AND af.max_delivery_distance_km IS NOT NULL
        )
        SELECT
          c.*
        FROM candidates c
        WHERE c.distance_km <= c.max_delivery_distance_km::float8
        ORDER BY
          c.distance_km ASC,
          c.rating DESC NULLS LAST,
          c.review_count DESC,
          c.id ASC
        LIMIT 1
      `,
      [foodId, lat, lng],
    );

    if (rows.length === 0) {
      const exists = await pool.query<{ id: string }>(
        "SELECT id FROM foods WHERE id = $1 LIMIT 1",
        [foodId],
      );
      if (exists.rows.length === 0) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Food not found" },
        });
      }
      return res.json({
        data: {
          found: false,
          basis,
          message: "Üzgünüm, bu yemek senin yakınında değil.",
        },
      });
    }

    const r = rows[0];
    return res.json({
      data: {
        found: true,
        basis,
        distanceKm: Number(r.distance_km ?? 0),
        food: {
          id: r.id,
          name: r.name,
          cardSummary: r.card_summary,
          description: r.description,
          price: parseFloat(r.price),
          imageUrl: resolvePrimaryFoodImage(r.image_urls_json, r.image_url),
          imageUrls: parseImageUrls(r.image_urls_json),
          rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
          reviewCount: Number(r.review_count ?? 0),
          prepTime: r.preparation_time_minutes,
          maxDistance: r.max_delivery_distance_km
            ? parseFloat(r.max_delivery_distance_km)
            : null,
          allergens: parseAllergens(r.allergens_json),
          ingredients: parseAllergens(r.ingredients_json),
          cuisine: r.cuisine ?? null,
          lotId: r.lot_id ?? null,
          category: r.category ?? null,
          stock: Number(r.stock ?? 0),
          seller: {
            id: r.seller_id,
            name: r.seller_name,
            username: r.seller_username,
            image: r.seller_image,
          },
        },
      },
    });
  } catch (err) {
    console.error("[foods] nearest top sold error:", err);
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to resolve nearest top sold food" },
    });
  }
});

/**
 * GET /v1/foods/recommendations
 * Personalized recommendations for current buyer:
 * - prioritize foods the buyer has not ordered before
 * - mix in top sellers
 * - occasionally include familiar top sellers
 */
foodsRouter.get("/recommendations", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "8"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 30) : 8;
    const buyerId = req.auth?.userId;

    const { rows } = await pool.query(
      `
        WITH available_foods AS (
          SELECT
            f.id,
            f.name,
            f.card_summary,
            f.description,
            f.price,
            f.image_url,
            f.image_urls_json,
            f.rating,
            f.review_count,
            f.preparation_time_minutes,
            u.delivery_radius_km AS seller_delivery_radius_km,
            f.allergens_json,
            f.ingredients_json,
            f.cuisine,
            COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
            (
              SELECT pl.id
              FROM production_lots pl
              WHERE pl.food_id = f.id
                AND pl.status IN ('open', 'active')
                AND pl.quantity_available > 0
                AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ORDER BY pl.quantity_available DESC, pl.created_at DESC
              LIMIT 1
            ) AS lot_id,
            c.name_tr AS category,
            u.id AS seller_id,
            u.display_name AS seller_name,
            u.username AS seller_username,
            u.profile_image_url AS seller_image,
            COALESCE(
              (SELECT SUM(pl.quantity_available)
               FROM production_lots pl
               WHERE pl.food_id = f.id
                 AND pl.status IN ('open', 'active')
                 AND pl.quantity_available > 0
                 AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                 AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ), 0
            )::int AS stock
          FROM foods f
          JOIN users u ON u.id = f.seller_id
          LEFT JOIN categories c ON c.id = f.category_id
          WHERE f.is_active = TRUE
            AND EXISTS (
              SELECT 1
              FROM production_lots plx
              WHERE plx.food_id = f.id
                AND plx.status IN ('open', 'active')
                AND plx.quantity_available > 0
                AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
                AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
            )
        ),
        user_history AS (
          SELECT
            oi.food_id,
            SUM(oi.quantity)::int AS user_order_count
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.buyer_id = $1
            AND o.payment_completed = TRUE
            AND o.status IN ('delivered', 'completed')
          GROUP BY oi.food_id
        ),
        global_sales AS (
          SELECT
            oi.food_id,
            SUM(oi.quantity)::int AS total_sold
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.payment_completed = TRUE
            AND o.status IN ('paid', 'preparing', 'ready', 'in_delivery', 'at_door', 'delivered', 'completed')
          GROUP BY oi.food_id
        )
        SELECT
          af.*,
          COALESCE(uh.user_order_count, 0)::int AS user_order_count,
          COALESCE(gs.total_sold, 0)::int AS total_sold
        FROM available_foods af
        LEFT JOIN user_history uh ON uh.food_id = af.id
        LEFT JOIN global_sales gs ON gs.food_id = af.id
      `,
      [buyerId],
    );

    const maxSold = rows.reduce((max, r) => Math.max(max, Number(r.total_sold ?? 0)), 0);
    const topSoldThreshold = Math.max(3, Math.floor(maxSold * 0.4));

    const scored = rows.map((r) => {
      const userOrderCount = Number(r.user_order_count ?? 0);
      const totalSold = Number(r.total_sold ?? 0);
      const isUntried = userOrderCount === 0;
      const isTopSold = totalSold >= topSoldThreshold;

      let score = 0;
      if (isUntried) score += 55;
      else score += Math.max(6, 22 - userOrderCount * 4);

      score += Math.log1p(totalSold) * 12;
      if (isTopSold) score += 18;
      if (!isUntried && isTopSold && Math.random() < 0.3) score += 10;
      if (isUntried && totalSold === 0) score -= 10;
      score += Math.random() * 12;

      const reason = buildRecommendationReason({
        foodName: String(r.name ?? ""),
        isUntried,
        isTopSold,
        userOrderCount,
      });

      return {
        score,
        item: {
          id: r.id,
          name: r.name,
          cardSummary: r.card_summary,
          description: r.description,
          price: parseFloat(r.price),
          deliveryFee: 0,
          deliveryOptions: sellerDeliveryOptions(r.seller_delivery_enabled),
          imageUrl: resolvePrimaryFoodImage(r.image_urls_json, r.image_url),
          imageUrls: parseImageUrls(r.image_urls_json),
          rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
          reviewCount: r.review_count,
          prepTime: r.preparation_time_minutes,
          maxDistance: r.seller_delivery_radius_km
            ? parseFloat(r.seller_delivery_radius_km)
            : null,
          allergens: parseAllergens(r.allergens_json),
          ingredients: parseAllergens(r.ingredients_json),
          cuisine: r.cuisine ?? null,
          lotId: r.lot_id ?? null,
          category: r.category,
          stock: Number(r.stock ?? 0),
          totalSold,
          reason,
          seller: {
            id: r.seller_id,
            name: r.seller_name,
            username: r.seller_username,
            image: r.seller_image,
          },
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    res.json({ data: scored.slice(0, limit).map((x) => x.item) });
  } catch (err) {
    console.error("[foods] recommendations error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load recommendations" },
    });
  }
});

/**
 * GET /v1/foods/sellers
 * List all active sellers from users table (seller/both), independent of seed data.
 * Query params: limit (default 200, max 500)
 */
foodsRouter.get("/sellers", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "200"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          COALESCE(NULLIF(u.display_name, ''), NULLIF(u.full_name, ''), u.email) AS seller_name,
          u.username AS seller_username,
          u.profile_image_url AS seller_image,
          u.user_type,
          COALESCE(stats.active_food_count, 0)::int AS active_food_count,
          COALESCE(stats.open_lot_count, 0)::int AS open_lot_count,
          COALESCE(review_stats.review_count, 0)::int AS review_count,
          COALESCE(review_stats.avg_rating, 0)::numeric AS avg_rating
        FROM users u
        LEFT JOIN LATERAL (
          SELECT
            COUNT(DISTINCT CASE WHEN f.is_active = TRUE THEN f.id END)::int AS active_food_count,
            COUNT(
              DISTINCT CASE
                WHEN pl.status IN ('open', 'active')
                 AND pl.quantity_available > 0
                 AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                 AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
                THEN pl.id
              END
            )::int AS open_lot_count
          FROM foods f
          LEFT JOIN production_lots pl ON pl.food_id = f.id
          WHERE f.seller_id = u.id
        ) stats ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS review_count,
            AVG(r.rating)::numeric AS avg_rating
          FROM reviews r
          WHERE r.seller_id = u.id
        ) review_stats ON TRUE
        WHERE u.is_active = TRUE
          AND u.user_type IN ('seller', 'both')
        ORDER BY
          stats.open_lot_count DESC,
          stats.active_food_count DESC,
          review_stats.review_count DESC,
          seller_name ASC
        LIMIT $1
      `,
      [limit],
    );

    const data = rows.map((r) => ({
      id: r.id as string,
      name: r.seller_name as string,
      username: (r.seller_username as string | null) ?? null,
      imageUrl: (r.seller_image as string | null) ?? null,
      userType: r.user_type as "seller" | "both",
      activeFoodCount: Number(r.active_food_count ?? 0),
      openLotCount: Number(r.open_lot_count ?? 0),
      reviewCount: Number(r.review_count ?? 0),
      avgRating: r.avg_rating ? Number.parseFloat(String(r.avg_rating)) : 0,
    }));

    res.json({ data });
  } catch (err) {
    console.error("[foods] sellers list error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load sellers" },
    });
  }
});

/**
 * GET /v1/foods/sellers/:sellerId/foods
 * List active/available foods for a specific seller.
 */
foodsRouter.get("/sellers/:sellerId/foods", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const menuColumnsEnabled = await hasFoodsMenuColumns();
    const { rows } = await pool.query(
      `
        SELECT
          f.id,
          f.name,
          f.card_summary,
          f.description,
          f.price,
          f.image_url,
          f.image_urls_json,
          f.rating,
          f.review_count,
          f.preparation_time_minutes,
          u.delivery_radius_km AS seller_delivery_radius_km,
          f.allergens_json,
          f.ingredients_json,
          f.cuisine,
          COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
          ${menuColumnsEnabled ? "f.menu_items_json, f.secondary_category_ids_json," : "'[]'::jsonb AS menu_items_json, '[]'::jsonb AS secondary_category_ids_json,"}
          f.category_id::text AS category_id,
          (
            SELECT pl.id
            FROM production_lots pl
            WHERE pl.food_id = f.id
              AND pl.status IN ('open', 'active')
              AND pl.quantity_available > 0
              AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
              AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
            ORDER BY pl.quantity_available DESC, pl.created_at DESC
            LIMIT 1
          ) AS lot_id,
          c.name_tr AS category,
          u.id AS seller_id,
          u.display_name AS seller_name,
          u.username AS seller_username,
          u.profile_image_url AS seller_image,
          COALESCE(
            (SELECT SUM(pl.quantity_available)
             FROM production_lots pl
             WHERE pl.food_id = f.id
               AND pl.status IN ('open', 'active')
               AND pl.quantity_available > 0
               AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
               AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
            ), 0
          )::int AS stock
        FROM foods f
        JOIN users u ON u.id = f.seller_id
        LEFT JOIN categories c ON c.id = f.category_id
        WHERE f.seller_id = $1
          AND f.is_active = true
          AND EXISTS (
            SELECT 1
            FROM production_lots plx
            WHERE plx.food_id = f.id
              AND plx.status IN ('open', 'active')
              AND plx.quantity_available > 0
              AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
              AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
          )
        ORDER BY f.rating DESC NULLS LAST, f.created_at DESC
      `,
      [sellerId],
    );

    const categoryIds = new Set<string>();
    for (const row of rows) {
      if (typeof row.category_id === "string" && row.category_id) categoryIds.add(row.category_id);
      for (const item of parseMenuItems((row as { menu_items_json?: unknown }).menu_items_json)) {
        if (item.categoryId) categoryIds.add(item.categoryId);
      }
      for (const id of parseSecondaryCategoryIds((row as { secondary_category_ids_json?: unknown }).secondary_category_ids_json)) {
        categoryIds.add(id);
      }
    }
    const categoryMap = await loadCategoryNameMap(Array.from(categoryIds));

    const foods = rows.map((r) => ({
      id: r.id,
      name: r.name,
      cardSummary: r.card_summary,
      description: r.description,
      price: parseFloat(r.price),
      deliveryFee: 0,
      deliveryOptions: sellerDeliveryOptions(r.seller_delivery_enabled),
      imageUrl: resolvePrimaryFoodImage(r.image_urls_json, r.image_url),
      imageUrls: parseImageUrls(r.image_urls_json),
      rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
      reviewCount: r.review_count,
      prepTime: r.preparation_time_minutes,
      maxDistance: r.seller_delivery_radius_km
        ? parseFloat(r.seller_delivery_radius_km)
        : null,
      allergens: parseAllergens(r.allergens_json),
      ingredients: parseAllergens(r.ingredients_json),
      cuisine: r.cuisine ?? null,
      menuItems: mapMenuItemsWithNames((r as { menu_items_json?: unknown }).menu_items_json, categoryMap),
      secondaryCategories: mapSecondaryCategories((r as { secondary_category_ids_json?: unknown }).secondary_category_ids_json, categoryMap),
      lotId: r.lot_id ?? null,
      category: r.category,
      stock: Number(r.stock ?? 0),
      seller: {
        id: r.seller_id,
        name: r.seller_name,
        username: r.seller_username,
        image: r.seller_image,
      },
    }));

    res.json({ data: foods });
  } catch (err) {
    console.error("[foods] seller foods error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller foods" },
    });
  }
});

/**
 * GET /v1/foods/sellers/:sellerId/reviews
 * List recent reviews for a seller.
 */
foodsRouter.get("/sellers/:sellerId/reviews", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rows } = await pool.query(
      `
        SELECT
          r.id,
          r.rating,
          r.comment,
          r.created_at,
          f.name AS food_name,
          COALESCE(b.display_name, 'Anonim Kullanici') AS buyer_name
        FROM reviews r
        JOIN foods f ON f.id = r.food_id
        LEFT JOIN users b ON b.id = r.buyer_id
        WHERE r.seller_id = $1
        ORDER BY r.created_at DESC
        LIMIT 50
      `,
      [sellerId],
    );

    const reviews = rows.map((r) => ({
      id: r.id as string,
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? "",
      foodName: r.food_name as string,
      buyerName: r.buyer_name as string,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    res.json({ data: reviews });
  } catch (err) {
    console.error("[foods] seller reviews error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller reviews" },
    });
  }
});

/**
 * GET /v1/foods/sellers/:sellerId/completed-sales
 * Return total sold meal quantity for completed orders only.
 */
foodsRouter.get("/sellers/:sellerId/completed-sales", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rows } = await pool.query<{ total_completed_meals: string }>(
      `
        SELECT COALESCE(SUM(oi.quantity), 0)::text AS total_completed_meals
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.seller_id = $1
          AND o.status = 'completed'
      `,
      [sellerId],
    );

    const totalCompletedMeals = Number(rows[0]?.total_completed_meals ?? "0");
    res.json({
      data: {
        sellerId,
        totalCompletedMeals,
      },
    });
  } catch (err) {
    console.error("[foods] seller completed sales error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller completed sales" },
    });
  }
});

/**
 * GET /v1/foods/sellers/:sellerId/address
 * Get seller's default address for pickup orders.
 */
foodsRouter.get("/sellers/:sellerId/address", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rows } = await pool.query(
      `SELECT title, address_line
       FROM user_addresses
       WHERE user_id = $1 AND is_default = TRUE
       LIMIT 1`,
      [sellerId],
    );

    if (rows.length === 0) {
      return res.json({ data: null });
    }

    res.json({
      data: {
        title: (rows[0].title as string | null) ?? null,
        addressLine: (rows[0].address_line as string | null) ?? null,
      },
    });
  } catch (err) {
    console.error("[foods] seller address error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller address" },
    });
  }
});
