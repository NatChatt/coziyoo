import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireSuperAdmin } from "../middleware/admin-rbac.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";
import { normalizeDeliveryType } from "../utils/delivery-type.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { hashPassword } from "../utils/security.js";
import { ensureUniqueUsername } from "../utils/username.js";

const AppUserListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z
    .enum([
      "id",
      "createdAt",
      "updatedAt",
      "email",
      "displayName",
      "userType",
      "status",
      "complaintTotal",
      "complaintUnresolved",
      "monthlyOrderCountCurrent",
      "monthlySpentCurrent",
      "lastOnlineAt",
      "latestComplaintId",
      "latestComplaintCreatedAt",
      "avgRating",
    ])
    .default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["active", "disabled"]).optional(),
  userType: z.enum(["buyer", "seller", "both"]).optional(),
  audience: z.enum(["buyer", "seller"]).optional(),
  smartFilter: z.enum([
    "daily_buyer",
    "top_revenue",
    "suspicious_login",
    "same_ip_multi_account",
    "complainers",
  ]).optional(),
  search: z.string().min(1).max(120).optional(),
});

const AdminUserListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "email", "role", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["admin", "super_admin"]).optional(),
  search: z.string().min(1).max(120).optional(),
});

const CreateAppUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(3).max(40),
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().min(3).max(40).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  profileImageUrl: z.string().url().max(2048).optional(),
  userType: z.enum(["buyer", "seller", "both"]),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
  isActive: z.boolean().optional(),
});

const UpdateAppUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  displayName: z.string().min(3).max(40).optional(),
  fullName: z.string().min(1).max(120).nullable().optional(),
  phone: z.string().min(3).max(40).nullable().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  profileImageUrl: z.string().url().max(2048).nullable().optional(),
  userType: z.enum(["buyer", "seller", "both"]).optional(),
  countryCode: z.string().min(2).max(3).nullable().optional(),
  language: z.string().min(2).max(10).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

const UpdateAppUserStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

const UpdateAppUserRoleSchema = z.object({
  role: z.enum(["buyer", "seller", "both"]),
});

const CreateAdminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "super_admin"]),
  isActive: z.boolean().optional(),
});

const UpdateAdminUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

const UpdateAdminUserStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

const UpdateAdminUserRoleSchema = z.object({
  role: z.enum(["admin", "super_admin"]),
});

const UuidParamSchema = z.object({
  id: z.string().uuid(),
});

const COMPLAINANT_TYPE_SQL = "COALESCE(to_jsonb(c) ->> 'complainant_type', 'buyer')";

const UserAddressParamsSchema = z.object({
  id: z.string().uuid(),
  addressId: z.string().uuid(),
});
const CreateUserAddressSchema = z.object({
  title: z.string().trim().min(1).max(80),
  addressLine: z.string().trim().min(3).max(500),
  isDefault: z.boolean().optional(),
});
const UpdateUserAddressSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  addressLine: z.string().trim().min(3).max(500).optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });

const BuyerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
const SellerFoodsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
const SellerFoodsExportQuerySchema = z.object({
  foodId: z.string().uuid().optional(),
  foodIds: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [];
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    })
    .refine((value) => value.every((item) => z.string().uuid().safeParse(item).success), {
      message: "foodIds must contain valid UUID values",
    }),
});
const SellerFoodParamsSchema = z.object({
  id: z.string().uuid(),
  foodId: z.string().uuid(),
});
const UpdateSellerFoodSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  recipe: z.string().trim().max(8000).nullable().optional(),
  price: z.coerce.number().finite().min(0).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });
const InvestigationSearchQuerySchema = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().positive().max(100).default(40),
});
const GlobalAdminSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().positive().max(30).default(12),
});
const ComplaintComplainantTypeSchema = z.enum(["buyer", "seller"]);
const InvestigationComplaintsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["createdAt", "ticketNo", "orderNo", "complainant", "category", "status", "priority"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["open", "in_review", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  categoryId: z.string().uuid().optional(),
  complainantBuyerId: z.string().uuid().optional(),
  complainantType: ComplaintComplainantTypeSchema.optional(),
  complainantUserId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  openOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
  search: z.string().min(1).max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const CreateComplaintCategorySchema = z.object({
  code: z.string().trim().min(2).max(64).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(120),
  isActive: z.boolean().optional(),
});
const CreateComplaintSchema = z.object({
  orderId: z.string().uuid(),
  complainantBuyerId: z.string().uuid().optional(),
  complainantType: ComplaintComplainantTypeSchema.optional(),
  complainantUserId: z.string().uuid().optional(),
  description: z.string().trim().min(3).max(4000),
  categoryId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignedAdminId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  const hasLegacyBuyer = Boolean(value.complainantBuyerId);
  const hasGeneralActor = Boolean(value.complainantType && value.complainantUserId);
  if (!hasLegacyBuyer && !hasGeneralActor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Complainant is required",
      path: ["complainantUserId"],
    });
  }
  if (value.complainantType && !value.complainantUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "complainantUserId is required with complainantType",
      path: ["complainantUserId"],
    });
  }
  if (value.complainantUserId && !value.complainantType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "complainantType is required with complainantUserId",
      path: ["complainantType"],
    });
  }
});
const UpdateComplaintSchema = z.object({
  description: z.string().trim().max(4000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["open", "in_review", "resolved", "closed"]).optional(),
  resolvedAt: z.coerce.date().nullable().optional(),
  resolutionNote: z.string().trim().max(4000).nullable().optional(),
  assignedAdminId: z.string().uuid().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field required" });
const CreateComplaintNoteSchema = z.object({
  note: z.string().trim().min(1).max(4000),
});
const BuyerSmsBodySchema = z.object({
  message: z.string().min(1).max(1000),
});
const BuyerNoteBodySchema = z.object({
  note: z.string().min(1).max(2000),
});
const BuyerTagBodySchema = z.object({
  tag: z.string().min(1).max(80),
});
const BuyerTagDeleteBodySchema = z.object({
  tag: z.string().min(1).max(80),
});
const BuyerTagParamsSchema = z.object({
  id: z.string().uuid(),
  tagId: z.string().uuid(),
});
const BuyerNotesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
const BuyerNoteParamsSchema = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
});
const BuyerNoteUpdateBodySchema = z.object({
  note: z.string().min(1).max(2000),
});

const DISPLAY_ID_LENGTH = 10;

const appSortFieldMap: Record<AppUserListQuery["sortBy"], string> = {
  id: "u.id",
  createdAt: "u.created_at",
  updatedAt: "u.updated_at",
  email: "u.email",
  displayName: "u.display_name",
  userType: "u.user_type",
  status: "u.is_active",
  complaintTotal: "complaint_total",
  complaintUnresolved: "complaint_unresolved",
  monthlyOrderCountCurrent: "COALESCE(order_stats.monthly_order_count_current, 0)",
  monthlySpentCurrent: "COALESCE(order_stats.monthly_spent_current, 0)",
  lastOnlineAt: "COALESCE(last_online_at, '')",
  latestComplaintId: "COALESCE(latest_complaint_id, '')",
  latestComplaintCreatedAt: "COALESCE(latest_complaint_created_at, '')",
  avgRating: "COALESCE(review_stats.avg_rating, 0)",
};

const adminSortFieldMap: Record<AdminUserListQuery["sortBy"], string> = {
  createdAt: "a.created_at",
  updatedAt: "a.updated_at",
  email: "a.email",
  role: "a.role",
  status: "a.is_active",
};

type AppUserListQuery = z.infer<typeof AppUserListQuerySchema>;
type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;
type BuyerSmartFilter = NonNullable<AppUserListQuery["smartFilter"]>;

export const adminUserManagementRouter = Router();

adminUserManagementRouter.get("/users/sellers/daily-sales", requireAuth("admin"), async (_req, res) => {
  const revenue = await pool.query<{ daily_sales: string }>(
    `SELECT COALESCE(sum(o.total_price), 0)::text AS daily_sales
     FROM orders o
     JOIN users s ON s.id = o.seller_id
     WHERE o.payment_completed = TRUE
       AND o.created_at >= date_trunc('day', now())
       AND o.created_at < (date_trunc('day', now()) + interval '1 day')
       AND upper(coalesce(s.country_code, '')) = 'TR'
       AND s.user_type IN ('seller', 'both')`
  );

  return res.json({
    data: {
      dailySales: Number(revenue.rows[0]?.daily_sales ?? 0),
      currency: "TRY",
      date: new Date().toISOString().slice(0, 10),
    },
  });
});

function buyerSmartFilterConditionSql(filter: BuyerSmartFilter): string {
  if (filter === "daily_buyer") {
    return `u.id IN (
      SELECT ranked.buyer_id
      FROM (
        SELECT
          o.buyer_id,
          COALESCE(sum(o.total_price), 0) AS day_spent,
          DENSE_RANK() OVER (ORDER BY COALESCE(sum(o.total_price), 0) DESC) AS rnk
        FROM orders o
        WHERE o.payment_completed = TRUE
          AND o.created_at >= date_trunc('day', now())
        GROUP BY o.buyer_id
      ) ranked
      WHERE ranked.rnk = 1
        AND ranked.day_spent > 0
    )`;
  }

  if (filter === "top_revenue") {
    return `u.id IN (
      SELECT ranked.buyer_id
      FROM (
        SELECT
          o.buyer_id,
          COALESCE(sum(o.total_price), 0) AS spent_30d,
          DENSE_RANK() OVER (ORDER BY COALESCE(sum(o.total_price), 0) DESC) AS rnk
        FROM orders o
        WHERE o.payment_completed = TRUE
          AND o.created_at >= (now() - interval '30 days')
        GROUP BY o.buyer_id
      ) ranked
      WHERE ranked.rnk <= 10
        AND ranked.spent_30d > 0
    )`;
  }

  if (filter === "suspicious_login") {
    return `EXISTS (
      SELECT 1
      FROM user_login_locations ul
      WHERE ul.user_id = u.id
        AND ul.created_at >= (now() - interval '24 hours')
      GROUP BY ul.user_id
      HAVING count(*) >= 2
         AND (
           count(DISTINCT COALESCE(NULLIF(ul.ip, ''), 'no-ip')) >= 2
           OR (max(ul.latitude) - min(ul.latitude)) > 1
           OR (max(ul.longitude) - min(ul.longitude)) > 1
         )
    )`;
  }

  if (filter === "same_ip_multi_account") {
    return `EXISTS (
      SELECT 1
      FROM user_login_locations ul
      WHERE ul.user_id = u.id
        AND ul.created_at >= (now() - interval '24 hours')
        AND NULLIF(ul.ip, '') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM user_login_locations ul2
          WHERE ul2.ip = ul.ip
            AND ul2.user_id <> u.id
            AND ul2.created_at >= (now() - interval '24 hours')
        )
    )`;
  }

  return `EXISTS (
    SELECT 1
    FROM complaints c
    WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer'
      AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = u.id
  )`;
}

async function ensureBuyerUser(userId: string) {
  const user = await pool.query<{ id: string; user_type: "buyer" | "seller" | "both" }>(
    "SELECT id, user_type FROM users WHERE id = $1",
    [userId]
  );
  if ((user.rowCount ?? 0) === 0) {
    return { ok: false as const, status: 404, code: "USER_NOT_FOUND", message: "User not found" };
  }
  const row = user.rows[0];
  if (row.user_type !== "buyer" && row.user_type !== "both") {
    return { ok: false as const, status: 409, code: "USER_NOT_BUYER", message: "User is not a buyer account" };
  }
  return { ok: true as const, user: row };
}

async function ensureSellerUser(userId: string) {
  const user = await pool.query<{ id: string; user_type: "buyer" | "seller" | "both" }>(
    "SELECT id, user_type FROM users WHERE id = $1",
    [userId]
  );
  if ((user.rowCount ?? 0) === 0) {
    return { ok: false as const, status: 404, code: "USER_NOT_FOUND", message: "User not found" };
  }
  const row = user.rows[0];
  if (row.user_type !== "seller" && row.user_type !== "both") {
    return { ok: false as const, status: 409, code: "USER_NOT_SELLER", message: "User is not a seller account" };
  }
  return { ok: true as const, user: row };
}

async function resolveComplaintComplainant(input: z.infer<typeof CreateComplaintSchema>) {
  if (input.complainantType && input.complainantUserId) {
    if (input.complainantType === "seller") {
      const seller = await ensureSellerUser(input.complainantUserId);
      if (!seller.ok) return seller;
      return {
        ok: true as const,
        complainantType: "seller" as const,
        complainantUserId: seller.user.id,
        complainantBuyerId: null,
      };
    }

    const buyer = await ensureBuyerUser(input.complainantUserId);
    if (!buyer.ok) return buyer;
    return {
      ok: true as const,
      complainantType: "buyer" as const,
      complainantUserId: buyer.user.id,
      complainantBuyerId: buyer.user.id,
    };
  }

  if (input.complainantBuyerId) {
    const buyer = await ensureBuyerUser(input.complainantBuyerId);
    if (!buyer.ok) return buyer;
    return {
      ok: true as const,
      complainantType: "buyer" as const,
      complainantUserId: buyer.user.id,
      complainantBuyerId: buyer.user.id,
    };
  }

  return {
    ok: false as const,
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Complainant is required",
  };
}

async function getBuyerRiskSnapshot(userId: string) {
  const [complaintStats, cancellationStats, failedPaymentStats] = await Promise.all([
    pool.query<{ open_count: string }>(
      `SELECT count(*)::text AS open_count
       FROM complaints
       WHERE COALESCE(to_jsonb(complaints) ->> 'complainant_type', 'buyer') = 'buyer'
         AND COALESCE(complainant_user_id, complainant_buyer_id) = $1
         AND status IN ('open', 'in_review')`,
      [userId]
    ),
    pool.query<{ cancelled_30d: string }>(
      `SELECT count(*)::text AS cancelled_30d
       FROM orders
       WHERE buyer_id = $1
         AND status = 'cancelled'
         AND created_at >= now() - interval '30 days'`,
      [userId]
    ),
    pool.query<{ failed_count: string }>(
      `SELECT count(*)::text AS failed_count
       FROM payment_attempts
       WHERE buyer_id = $1
         AND status IN ('failed', 'cancelled', 'declined')
         AND updated_at >= now() - interval '30 days'`,
      [userId]
    ),
  ]);

  const openComplaints = Number(complaintStats.rows[0]?.open_count ?? "0");
  const cancellations30d = Number(cancellationStats.rows[0]?.cancelled_30d ?? "0");
  const failedPayments = Number(failedPaymentStats.rows[0]?.failed_count ?? "0");

  const reasons: string[] = [];
  let level: "low" | "medium" | "high" = "low";
  if (openComplaints >= 2) {
    level = "high";
    reasons.push("open_complaints>=2");
  } else if (openComplaints === 1) {
    level = "medium";
    reasons.push("open_complaints==1");
  }
  if (cancellations30d >= 3) {
    if (level !== "high") level = "medium";
    reasons.push("cancellations_30d>=3");
  }
  if (failedPayments >= 2) {
    if (level !== "high") level = "medium";
    reasons.push("failed_payments>=2");
  }

  return {
    riskLevel: level,
    riskReasons: reasons,
    openComplaints,
    cancellations30d,
    failedPayments,
  };
}

function textItemsFromJson(value: unknown): string[] {
  const acc: string[] = [];

  const pushIf = (raw: unknown) => {
    const text = String(raw ?? "").trim();
    if (text) acc.push(text);
  };

  const walk = (input: unknown) => {
    if (!input) return;
    if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
      pushIf(input);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) walk(item);
      return;
    }
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      const preferred = [record.name, record.label, record.value, record.ingredient];
      let picked = false;
      for (const item of preferred) {
        if (typeof item === "string" && item.trim()) {
          pushIf(item);
          picked = true;
          break;
        }
      }
      if (picked) return;
      for (const item of Object.values(record)) walk(item);
    }
  };

  walk(value);
  return Array.from(new Set(acc.map((item) => item.trim()).filter(Boolean)));
}

function ingredientsTextFromJson(value: unknown): string | null {
  const unique = textItemsFromJson(value);
  return unique.length > 0 ? unique.join(", ") : null;
}

function imageUrlsFromJson(value: unknown, fallbackImageUrl?: string | null): string[] {
  const urls = Array.isArray(value)
    ? value
      .map((item) => String(item ?? "").trim())
      .filter((item) => /^https?:\/\//i.test(item) || /^data:/i.test(item))
    : [];
  if (urls.length > 0) return urls.slice(0, 5);
  const fallback = String(fallbackImageUrl ?? "").trim();
  return fallback ? [fallback] : [];
}

function menuItemsFromJson(value: unknown): Array<{
  name: string;
  categoryId?: string;
  categoryName?: string | null;
  kind?: "sauce" | "extra" | "appetizer";
  pricing?: "free" | "paid";
  price?: number;
}> {
  if (!Array.isArray(value)) return [];
  const out: Array<{
    name: string;
    categoryId?: string;
    categoryName?: string | null;
    kind?: "sauce" | "extra" | "appetizer";
    pricing?: "free" | "paid";
    price?: number;
  }> = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const kindRaw = String(row.kind ?? "").trim().toLowerCase();
    const kind: "sauce" | "extra" | "appetizer" =
      kindRaw === "sauce" || kindRaw === "appetizer" ? kindRaw : "extra";
    const pricingRaw = String(row.pricing ?? "").trim().toLowerCase();
    const pricing: "free" | "paid" = pricingRaw === "paid" ? "paid" : "free";
    const categoryId = typeof row.categoryId === "string" && row.categoryId.trim() ? row.categoryId.trim() : undefined;
    const categoryName = typeof row.categoryName === "string" && row.categoryName.trim() ? row.categoryName.trim() : null;
    const priceNum = Number(row.price);
    const key = `${name.toLocaleLowerCase("tr-TR")}|${kind}|${pricing}|${Number.isFinite(priceNum) ? Number(priceNum).toFixed(2) : "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      ...(categoryId ? { categoryId } : {}),
      ...(categoryName ? { categoryName } : {}),
      kind,
      pricing,
      ...(pricing === "paid" && Number.isFinite(priceNum) && priceNum > 0 ? { price: Number(priceNum.toFixed(2)) } : {}),
    });
  }
  return out;
}


function stableExportStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableExportStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${key}:${stableExportStringify(obj[key])}`).join(",")}}`;
  }
  return String(value);
}

function lotSnapshotSummary(params: {
  foodRecipe: string | null;
  foodIngredients: unknown;
  foodAllergens: unknown;
  lotRecipe: string | null;
  lotIngredients: unknown;
  lotAllergens: unknown;
}): string {
  const hasMissingSnapshot = !params.lotRecipe || params.lotIngredients == null || params.lotAllergens == null;
  const notes: string[] = [];
  if (hasMissingSnapshot) notes.push("Snapshot missing");
  if (stableExportStringify(params.foodRecipe) !== stableExportStringify(params.lotRecipe)) notes.push("Recipe changed");
  if (stableExportStringify(params.foodIngredients) !== stableExportStringify(params.lotIngredients)) notes.push("Ingredients changed");
  if (stableExportStringify(params.foodAllergens) !== stableExportStringify(params.lotAllergens)) notes.push("Allergens changed");
  return notes.join(" | ") || "Snapshot OK";
}

function lotLifecycleForExport(status: string, saleStartsAt: string | null, saleEndsAt: string | null): string {
  if (status === "recalled") return "Recalled";
  if (status === "discarded") return "Discarded";
  if (status === "depleted") return "Depleted";
  const now = Date.now();
  const end = saleEndsAt ? Date.parse(saleEndsAt) : Number.NaN;
  if (Number.isFinite(end) && end < now) return "Expired";
  return "On Sale";
}

function escapeSpreadsheetXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createExcelXmlBuffer(rows: Array<Record<string, string | number>>, sheetName: string): Buffer {
  const headers = Array.from(
    rows.reduce((acc, row) => {
      for (const key of Object.keys(row)) acc.add(key);
      return acc;
    }, new Set<string>())
  );

  const headerRowXml = headers
    .map((header) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeSpreadsheetXml(header)}</Data></Cell>`)
    .join("");

  const dataRowsXml = rows.map((row) => {
    const cells = headers.map((header) => {
      const value = row[header] ?? "";
      const isNumber = typeof value === "number" && Number.isFinite(value);
      return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeSpreadsheetXml(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeSpreadsheetXml(sheetName)}">
  <Table>
   <Row>${headerRowXml}</Row>
   ${dataRowsXml}
  </Table>
 </Worksheet>
</Workbook>`;

  return Buffer.from(xml, "utf8");
}

adminUserManagementRouter.get("/investigations/complaints", requireAuth("admin"), async (req, res) => {
  const parsed = InvestigationComplaintsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const {
    page,
    pageSize,
    sortBy,
    sortDir,
    status,
    priority,
    categoryId,
    complainantBuyerId,
    complainantType,
    complainantUserId,
    sellerId,
    openOnly,
    search,
    from,
    to,
  } =
    parsed.data;
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    where.push(`c.priority = $${params.length}`);
  }
  if (categoryId) {
    params.push(categoryId);
    where.push(`c.category_id = $${params.length}`);
  }
  if (complainantBuyerId) {
    params.push(complainantBuyerId);
    where.push(`c.complainant_buyer_id = $${params.length}`);
  }
  if (complainantType && complainantUserId) {
    params.push(complainantType, complainantUserId);
    where.push(`COALESCE(to_jsonb(c) ->> 'complainant_type', 'buyer') = $${params.length - 1} AND c.complainant_user_id = $${params.length}`);
  }
  if (sellerId) {
    params.push(sellerId);
    where.push(`o.seller_id = $${params.length}`);
  }
  if (openOnly) {
    where.push(`c.status IN ('open', 'in_review')`);
  }
  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where.push(`(
      lower(COALESCE(c.description, '')) LIKE $${params.length}
      OR lower(o.id::text) LIKE $${params.length}
      OR lower(COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text)) LIKE $${params.length}
      OR lower(COALESCE(cat.name, '')) LIKE $${params.length}
      OR lower(COALESCE(cat.code, '')) LIKE $${params.length}
    )`);
  }
  if (from) {
    params.push(from);
    where.push(`c.created_at::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`c.created_at::date <= $${params.length}::date`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const complaintsSortFieldMap: Record<(typeof parsed.data)["sortBy"], string> = {
    createdAt: "c.created_at",
    ticketNo: "c.ticket_no",
    orderNo: "o.id",
    complainant:
      "COALESCE(NULLIF(actor.display_name, ''), NULLIF(actor.full_name, ''), NULLIF(actor.email, ''), COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text))",
    category: "COALESCE(cat.name, '')",
    status: "c.status",
    priority: "c.priority",
  };
  const orderBy = complaintsSortFieldMap[sortBy];
  const orderDir = sortDir === "asc" ? "ASC" : "DESC";

  const countResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM complaints c
     JOIN orders o ON o.id = c.order_id
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     ${whereSql}`,
    params
  );

  params.push(pageSize, offset);
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;
  const rows = await pool.query<{
    id: string;
    order_id: string;
    ticket_no: number;
    complainant_type: "buyer" | "seller";
    complainant_user_id: string;
    complainant_name: string | null;
    description: string | null;
    category_id: string | null;
    category_code: string | null;
    category_name: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    resolved_at: string | null;
    resolution_note: string | null;
    assigned_admin_id: string | null;
    assigned_admin_email: string | null;
    created_at: string;
    status: "open" | "in_review" | "resolved" | "closed";
  }>(
    `SELECT
       c.id::text,
       c.order_id::text,
       c.ticket_no,
       ${COMPLAINANT_TYPE_SQL} AS complainant_type,
       COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) AS complainant_user_id,
       COALESCE(NULLIF(actor.display_name, ''), NULLIF(actor.full_name, ''), NULLIF(actor.email, ''), COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text)) AS complainant_name,
       c.description,
       c.category_id::text,
       cat.code AS category_code,
       cat.name AS category_name,
       c.priority,
       c.resolved_at::text,
       c.resolution_note,
       c.assigned_admin_id::text,
       au.email AS assigned_admin_email,
       c.created_at::text,
       c.status
     FROM complaints c
     JOIN orders o ON o.id = c.order_id
     LEFT JOIN users actor ON actor.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     LEFT JOIN admin_users au ON au.id = c.assigned_admin_id
     ${whereSql}
     ORDER BY ${orderBy} ${orderDir}, c.id ${orderDir}
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params
  );

  const total = Number(countResult.rows[0]?.count ?? "0");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      ticketNo: row.ticket_no,
      orderNo: `#${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      complainantType: row.complainant_type,
      complainantUserId: row.complainant_user_id,
      complainantName: row.complainant_name ?? row.complainant_user_id,
      description: row.description,
      categoryId: row.category_id,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      priority: row.priority,
      resolvedAt: row.resolved_at,
      resolutionNote: row.resolution_note,
      assignedAdminId: row.assigned_admin_id,
      assignedAdminEmail: row.assigned_admin_email,
      createdAt: row.created_at,
      status: row.status,
    })),
    pagination: {
      total,
      totalPages,
      page,
      pageSize,
    },
  });
});

adminUserManagementRouter.get("/investigations/complaint-categories", requireAuth("admin"), async (_req, res) => {
  const rows = await pool.query<{
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id::text, code, name, is_active, created_at::text
     FROM complaint_categories
     ORDER BY is_active DESC, name ASC`
  );
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.is_active,
      createdAt: row.created_at,
    })),
  });
});

adminUserManagementRouter.get("/investigations/complaints/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const detail = await pool.query<{
    id: string;
    order_id: string;
    ticket_no: number;
    complainant_type: "buyer" | "seller";
    complainant_user_id: string;
    complainant_name: string | null;
    complainant_email: string | null;
    complained_against_type: "buyer" | "seller";
    complained_against_user_id: string;
    complained_against_name: string | null;
    complained_against_email: string | null;
    description: string | null;
    category_id: string | null;
    category_code: string | null;
    category_name: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    resolved_at: string | null;
    resolution_note: string | null;
    assigned_admin_id: string | null;
    assigned_admin_email: string | null;
    created_at: string;
    status: "open" | "in_review" | "resolved" | "closed";
    order_delivery_type: "pickup" | "delivery" | null;
    order_delivery_address_json: unknown;
    order_buyer_name: string | null;
    order_buyer_email: string | null;
    order_seller_name: string | null;
    order_seller_email: string | null;
    order_items_json: Array<{ foodId: string; foodName: string | null; quantity: number }> | null;
  }>(
    `SELECT
       c.id::text,
       c.order_id::text,
       c.ticket_no,
       ${COMPLAINANT_TYPE_SQL} AS complainant_type,
       COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) AS complainant_user_id,
       actor.display_name AS complainant_name,
       actor.email AS complainant_email,
       CASE WHEN ${COMPLAINANT_TYPE_SQL} = 'seller' THEN 'buyer' ELSE 'seller' END AS complained_against_type,
       CASE
         WHEN ${COMPLAINANT_TYPE_SQL} = 'seller' THEN o.buyer_id::text
         ELSE seller_snapshot.seller_id
       END AS complained_against_user_id,
       CASE
         WHEN ${COMPLAINANT_TYPE_SQL} = 'seller' THEN buyer_target.display_name
         ELSE seller_target.display_name
       END AS complained_against_name,
       CASE
         WHEN ${COMPLAINANT_TYPE_SQL} = 'seller' THEN buyer_target.email
         ELSE seller_target.email
       END AS complained_against_email,
       c.description,
       c.category_id::text,
       cat.code AS category_code,
       cat.name AS category_name,
       c.priority,
       c.resolved_at::text,
       c.resolution_note,
       c.assigned_admin_id::text,
       au.email AS assigned_admin_email,
       c.created_at::text,
       c.status,
       o.delivery_type AS order_delivery_type,
       o.delivery_address_json AS order_delivery_address_json,
       buyer_target.display_name AS order_buyer_name,
       buyer_target.email AS order_buyer_email,
       seller_target.display_name AS order_seller_name,
       seller_target.email AS order_seller_email,
       order_items.items AS order_items_json
     FROM complaints c
     JOIN orders o ON o.id = c.order_id
     LEFT JOIN users actor ON actor.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         NULLIF((
           SELECT oe.payload_json ->> 'sellerId'
           FROM order_events oe
           WHERE oe.order_id = o.id
             AND oe.event_type = 'order_created'
           ORDER BY oe.created_at ASC
           LIMIT 1
         ), ''),
         o.seller_id::text
       ) AS seller_id
     ) seller_snapshot ON TRUE
     LEFT JOIN users seller_target ON seller_target.id::text = seller_snapshot.seller_id
     LEFT JOIN users buyer_target ON buyer_target.id = o.buyer_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         json_agg(
           json_build_object(
             'foodId', oi.food_id::text,
             'foodName', f.name,
             'quantity', oi.quantity
           ) ORDER BY oi.created_at ASC
         ),
         '[]'::json
       ) AS items
       FROM order_items oi
       LEFT JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) order_items ON TRUE
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     LEFT JOIN admin_users au ON au.id = c.assigned_admin_id
     WHERE c.id = $1
     LIMIT 1`,
    [params.data.id]
  );

  const row = detail.rows[0];
  if (!row) {
    return res.status(404).json({ error: { code: "COMPLAINT_NOT_FOUND", message: "Complaint not found" } });
  }

  return res.json({
    data: {
      id: row.id,
      ticketNo: row.ticket_no,
      orderId: row.order_id,
      orderNo: `#${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      complainantType: row.complainant_type,
      complainantUserId: row.complainant_user_id,
      complainantName: row.complainant_name ?? row.complainant_email ?? row.complainant_user_id,
      complainantEmail: row.complainant_email,
      complainedAgainstType: row.complained_against_type,
      complainedAgainstUserId: row.complained_against_user_id,
      complainedAgainstName: row.complained_against_name ?? row.complained_against_email ?? row.complained_against_user_id,
      complainedAgainstEmail: row.complained_against_email,
      description: row.description,
      categoryId: row.category_id,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      priority: row.priority,
      resolvedAt: row.resolved_at,
      resolutionNote: row.resolution_note,
      assignedAdminId: row.assigned_admin_id,
      assignedAdminEmail: row.assigned_admin_email,
      createdAt: row.created_at,
      status: row.status,
      orderSummary: {
        buyerName: row.order_buyer_name ?? row.order_buyer_email ?? "-",
        sellerName: row.order_seller_name ?? row.order_seller_email ?? "-",
        deliveryType: normalizeDeliveryType(row.order_delivery_type) ?? row.order_delivery_type,
        deliveryAddress: row.order_delivery_address_json ?? null,
        items: row.order_items_json ?? [],
      },
    },
  });
});

adminUserManagementRouter.get("/investigations/complaints/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const rows = await pool.query<{
    id: string;
    complaint_id: string;
    note: string;
    created_by_admin_id: string;
    created_by_admin_email: string | null;
    sender_role: "buyer" | "admin";
    sender_name: string | null;
    created_at: string;
  }>(
    `SELECT
       n.id::text,
       n.complaint_id::text,
       n.note,
       n.created_by_admin_id::text,
       a.email AS created_by_admin_email,
       'admin'::text AS sender_role,
       a.email AS sender_name,
       n.created_at::text
     FROM complaint_admin_notes n
     LEFT JOIN admin_users a ON a.id = n.created_by_admin_id
     WHERE n.complaint_id = $1
     UNION ALL
     SELECT
       tm.id::text,
       tm.complaint_id::text,
       tm.message AS note,
       COALESCE(tm.sender_user_id::text, '') AS created_by_admin_id,
       NULL::text AS created_by_admin_email,
       tm.sender_role,
       tm.sender_name,
       tm.created_at::text
     FROM ticket_messages tm
     WHERE tm.complaint_id = $1
     ORDER BY created_at DESC`,
    [params.data.id]
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      complaintId: row.complaint_id,
      note: row.note,
      createdByAdminId: row.created_by_admin_id,
      createdByAdminEmail: row.created_by_admin_email,
      senderRole: row.sender_role,
      senderName: row.sender_name,
      createdAt: row.created_at,
    })),
  });
});

adminUserManagementRouter.post("/investigations/complaints/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = CreateComplaintNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const complaintExists = await pool.query<{ id: string }>("SELECT id::text FROM complaints WHERE id = $1 LIMIT 1", [params.data.id]);
  if ((complaintExists.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "COMPLAINT_NOT_FOUND", message: "Complaint not found" } });
  }

  const created = await pool.query<{
    id: string;
    complaint_id: string;
    note: string;
    created_by_admin_id: string;
    created_at: string;
  }>(
    `INSERT INTO complaint_admin_notes (complaint_id, note, created_by_admin_id, created_at)
     VALUES ($1, $2, $3, now())
     RETURNING id::text, complaint_id::text, note, created_by_admin_id::text, created_at::text`,
    [params.data.id, parsed.data.note, req.auth!.userId]
  );

  await pool.query("UPDATE complaints SET updated_at = now() WHERE id = $1", [params.data.id]);

  return res.status(201).json({
    data: {
      id: created.rows[0].id,
      complaintId: created.rows[0].complaint_id,
      note: created.rows[0].note,
      createdByAdminId: created.rows[0].created_by_admin_id,
      createdAt: created.rows[0].created_at,
    },
  });
});

adminUserManagementRouter.get("/investigations/tickets/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  return res.redirect(307, `/v1/admin/investigations/complaints/${params.data.id}`);
});

adminUserManagementRouter.get("/investigations/tickets/:id/messages", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  return res.redirect(307, `/v1/admin/investigations/complaints/${params.data.id}/notes`);
});

adminUserManagementRouter.post("/investigations/tickets/:id/messages", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  return res.redirect(307, `/v1/admin/investigations/complaints/${params.data.id}/notes`);
});

adminUserManagementRouter.patch("/investigations/tickets/:id/status", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = z.object({ status: z.enum(["open", "in_review", "resolved", "closed"]) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const updated = await pool.query<{ id: string; status: string }>(
    `UPDATE complaints
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id::text, status`,
    [params.data.id, parsed.data.status]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" } });
  }
  return res.json({ data: { id: updated.rows[0].id, status: updated.rows[0].status } });
});

adminUserManagementRouter.patch("/investigations/tickets/:id/priority", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = z.object({ priority: z.enum(["low", "medium", "high", "urgent"]) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const updated = await pool.query<{ id: string; priority: string }>(
    `UPDATE complaints
     SET priority = $2, updated_at = now()
     WHERE id = $1
     RETURNING id::text, priority`,
    [params.data.id, parsed.data.priority]
  );
  if (!updated.rows[0]) {
    return res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" } });
  }
  return res.json({ data: { id: updated.rows[0].id, priority: updated.rows[0].priority } });
});

adminUserManagementRouter.post("/investigations/complaint-categories", requireAuth("admin"), async (req, res) => {
  const parsed = CreateComplaintCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { code, name, isActive = true } = parsed.data;
  const created = await pool.query<{
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    created_at: string;
  }>(
    `INSERT INTO complaint_categories (code, name, is_active)
     VALUES ($1, $2, $3)
     RETURNING id::text, code, name, is_active, created_at::text`,
    [code, name, isActive]
  );

  return res.status(201).json({
    data: {
      id: created.rows[0].id,
      code: created.rows[0].code,
      name: created.rows[0].name,
      isActive: created.rows[0].is_active,
      createdAt: created.rows[0].created_at,
    },
  });
});

adminUserManagementRouter.post("/investigations/complaints", requireAuth("admin"), async (req, res) => {
  const parsed = CreateComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const complainant = await resolveComplaintComplainant(input);
  if (!complainant.ok) {
    return res.status(complainant.status).json({ error: { code: complainant.code, message: complainant.message } });
  }
  const orderActors = await pool.query<{ buyer_id: string; seller_id: string }>(
    "SELECT buyer_id::text, seller_id::text FROM orders WHERE id = $1 LIMIT 1",
    [input.orderId]
  );
  const orderActorRow = orderActors.rows[0];
  if (!orderActorRow) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  const expectedComplainantId = complainant.complainantType === "seller" ? orderActorRow.seller_id : orderActorRow.buyer_id;
  if (expectedComplainantId !== complainant.complainantUserId) {
    return res.status(409).json({
      error: {
        code: "COMPLAINANT_ORDER_MISMATCH",
        message: "Complainant must belong to the selected order",
      },
    });
  }
  const created = await pool.query<{
    id: string;
    created_at: string;
  }>(
    `INSERT INTO complaints (
       order_id,
       complainant_buyer_id,
       complainant_type,
       complainant_user_id,
       description,
       category_id,
       priority,
       assigned_admin_id,
       status
     )
     VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, 'open')
     RETURNING id::text, created_at::text`,
    [
      input.orderId,
      complainant.complainantBuyerId,
      complainant.complainantType,
      complainant.complainantUserId,
      input.description,
      input.categoryId ?? null,
      input.priority,
      input.assignedAdminId ?? null,
    ]
  );

  return res.status(201).json({
    data: {
      id: created.rows[0].id,
      createdAt: created.rows[0].created_at,
      status: "open",
    },
  });
});

adminUserManagementRouter.patch("/investigations/complaints/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = UpdateComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const status = input.status;
  const priorityValue = input.priority
    ?? ((status === "resolved" || status === "closed")
      ? "low"
      : (status === "open" || status === "in_review")
        ? "medium"
        : undefined);
  const resolvedAtValue = input.resolvedAt !== undefined
    ? input.resolvedAt
    : (status === "resolved" || status === "closed" ? new Date() : undefined);

  const updated = await pool.query<{
    id: string;
    priority: string;
    status: string;
    resolved_at: string | null;
  }>(
    `UPDATE complaints
     SET
       description = CASE WHEN $2::boolean THEN $3 ELSE description END,
       category_id = CASE WHEN $4::boolean THEN $5 ELSE category_id END,
       priority = COALESCE($6, priority),
       status = COALESCE($7, status),
       resolved_at = CASE WHEN $8::boolean THEN $9 ELSE resolved_at END,
       resolution_note = CASE WHEN $10::boolean THEN $11 ELSE resolution_note END,
       assigned_admin_id = CASE WHEN $12::boolean THEN $13 ELSE assigned_admin_id END
     WHERE id = $1
     RETURNING id::text, priority, status, resolved_at::text`,
    [
      params.data.id,
      input.description !== undefined,
      input.description ?? null,
      input.categoryId !== undefined,
      input.categoryId ?? null,
      priorityValue ?? null,
      input.status ?? null,
      resolvedAtValue !== undefined,
      resolvedAtValue ? resolvedAtValue.toISOString() : null,
      input.resolutionNote !== undefined,
      input.resolutionNote ?? null,
      input.assignedAdminId !== undefined,
      input.assignedAdminId ?? null,
    ]
  );

  if (!updated.rows[0]) {
    return res.status(404).json({ error: { code: "COMPLAINT_NOT_FOUND", message: "Complaint not found" } });
  }

  return res.json({
    data: {
      id: updated.rows[0].id,
      priority: updated.rows[0].priority,
      status: updated.rows[0].status,
      resolvedAt: updated.rows[0].resolved_at,
    },
  });
});

adminUserManagementRouter.get("/investigations/search", requireAuth("admin"), async (req, res) => {
  const parsed = InvestigationSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const needle = `%${input.q.toLowerCase()}%`;
  const rows = await pool.query<{
    food_id: string;
    food_name: string;
    food_image_url: string | null;
    ingredients_json: unknown;
    card_summary: string | null;
    description: string | null;
    recipe: string | null;
    food_price: string;
    food_status: boolean;
    food_created_at: string;
    food_updated_at: string;
    seller_id: string;
    seller_name: string;
    seller_email: string;
    seller_country_code: string | null;
    seller_language: string | null;
    seller_status: boolean;
    order_id: string | null;
    order_status: string | null;
    order_total_price: string | null;
    order_created_at: string | null;
    order_updated_at: string | null;
    order_requested_at: string | null;
    delivery_address_json: unknown;
    buyer_id: string | null;
    buyer_name: string | null;
    buyer_email: string | null;
    quantity: number | null;
    unit_price: string | null;
    line_total: string | null;
    payment_status: string | null;
    payment_provider: string | null;
    payment_updated_at: string | null;
  }>(
    `SELECT
       f.id::text AS food_id,
       f.name AS food_name,
       f.image_url AS food_image_url,
       f.ingredients_json,
       f.card_summary,
       f.description,
       f.recipe,
       f.price::text AS food_price,
       f.is_active AS food_status,
       f.created_at::text AS food_created_at,
       f.updated_at::text AS food_updated_at,
       s.id::text AS seller_id,
       s.display_name AS seller_name,
       s.email AS seller_email,
       s.country_code AS seller_country_code,
       s.language AS seller_language,
       s.is_active AS seller_status,
       o.id::text AS order_id,
       o.status AS order_status,
       o.total_price::text AS order_total_price,
       o.created_at::text AS order_created_at,
       o.updated_at::text AS order_updated_at,
       o.requested_at::text AS order_requested_at,
       o.delivery_address_json,
       b.id::text AS buyer_id,
       b.display_name AS buyer_name,
       b.email AS buyer_email,
       oi.quantity,
       oi.unit_price::text AS unit_price,
       oi.line_total::text AS line_total,
       pa.status AS payment_status,
       pa.provider AS payment_provider,
       pa.updated_at::text AS payment_updated_at
     FROM foods f
     JOIN users s ON s.id = f.seller_id
     LEFT JOIN order_items oi ON oi.food_id = f.id
     LEFT JOIN orders o ON o.id = oi.order_id
     LEFT JOIN users b ON b.id = o.buyer_id
     LEFT JOIN LATERAL (
       SELECT status, provider, updated_at
       FROM payment_attempts
       WHERE order_id = o.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) pa ON TRUE
     WHERE
       lower(f.name) LIKE $1
       OR lower('FD-' || substring(f.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
       OR lower('FD-' || f.id::text) LIKE $1
     ORDER BY o.created_at DESC NULLS LAST, f.updated_at DESC
     LIMIT $2`,
    [needle, input.limit]
  );

  const grouped = new Map<
    string,
    {
        food: {
          id: string;
          code: string;
          name: string;
          imageUrl: string | null;
          ingredients: string | null;
          cardSummary: string | null;
          description: string | null;
          recipe: string | null;
        price: number;
        status: "active" | "disabled";
        createdAt: string;
        updatedAt: string;
      };
      seller: {
        id: string;
        name: string;
        email: string;
        countryCode: string | null;
        language: string | null;
        status: "active" | "disabled";
      };
      incidents: Array<{
        orderId: string;
        orderNo: string;
        orderStatus: string;
        orderTotal: number;
        orderCreatedAt: string;
        orderUpdatedAt: string;
        orderRequestedAt: string | null;
        region: string | null;
        buyer: { id: string; name: string | null; email: string | null };
        item: { quantity: number; unitPrice: number; lineTotal: number };
        payment: { status: string | null; provider: string | null; updatedAt: string | null };
      }>;
    }
  >();

  for (const row of rows.rows) {
    const foodId = row.food_id;
    let entry = grouped.get(foodId);
    if (!entry) {
      entry = {
        food: {
          id: foodId,
          code: `FD-${foodId.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
          name: row.food_name,
          imageUrl: row.food_image_url,
          ingredients: ingredientsTextFromJson(row.ingredients_json),
          cardSummary: row.card_summary,
          description: row.description,
          recipe: row.recipe,
          price: Number(row.food_price),
          status: row.food_status ? "active" : "disabled",
          createdAt: row.food_created_at,
          updatedAt: row.food_updated_at,
        },
        seller: {
          id: row.seller_id,
          name: row.seller_name,
          email: row.seller_email,
          countryCode: row.seller_country_code,
          language: row.seller_language,
          status: row.seller_status ? "active" : "disabled",
        },
        incidents: [],
      };
      grouped.set(foodId, entry);
    }

    if (!row.order_id) continue;
    const address = row.delivery_address_json && typeof row.delivery_address_json === "object"
      ? (row.delivery_address_json as Record<string, unknown>)
      : null;
    const regionParts = [address?.district, address?.city, address?.country]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    entry.incidents.push({
      orderId: row.order_id,
      orderNo: `#${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      orderStatus: row.order_status ?? "-",
      orderTotal: Number(row.order_total_price ?? 0),
      orderCreatedAt: row.order_created_at ?? row.order_updated_at ?? "",
      orderUpdatedAt: row.order_updated_at ?? row.order_created_at ?? "",
      orderRequestedAt: row.order_requested_at,
      region: regionParts.length > 0 ? regionParts.join(" / ") : null,
      buyer: {
        id: row.buyer_id ?? "",
        name: row.buyer_name,
        email: row.buyer_email,
      },
      item: {
        quantity: Number(row.quantity ?? 0),
        unitPrice: Number(row.unit_price ?? 0),
        lineTotal: Number(row.line_total ?? 0),
      },
      payment: {
        status: row.payment_status,
        provider: row.payment_provider,
        updatedAt: row.payment_updated_at,
      },
    });
  }

  return res.json({
    data: Array.from(grouped.values()),
  });
});

adminUserManagementRouter.get("/search/global", requireAuth("admin"), async (req, res) => {
  const parsed = GlobalAdminSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const normalized = input.q.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const needle = `%${normalized}%`;
  const compactNeedle = `%${compact}%`;
  const perKindLimit = Math.min(8, input.limit);

  const safeQuery = async <T extends Record<string, unknown>>(label: string, sql: string, params: unknown[]) => {
    try {
      return await pool.query<T>(sql, params);
    } catch (error) {
      console.error(`[admin.search.global] ${label} query failed`, error);
      return { rows: [] as T[] };
    }
  };

  const [sellers, buyers, foods, orders, lots, complaints] = await Promise.all([
    safeQuery<{
      id: string;
      display_name: string | null;
      email: string;
      is_active: boolean;
    }>(
      "sellers",
      `SELECT u.id::text, u.display_name, u.email, u.is_active
       FROM users u
       WHERE u.user_type IN ('seller', 'both')
         AND (
           lower(u.display_name) LIKE $1
           OR lower(u.email) LIKE $1
           OR lower(u.id::text) LIKE $1
           OR lower('cust-' || substring(u.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
           OR regexp_replace(lower(u.id::text), '[^a-z0-9]', '', 'g') LIKE $2
         )
       ORDER BY u.updated_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
    safeQuery<{
      id: string;
      display_name: string | null;
      email: string;
      is_active: boolean;
    }>(
      "buyers",
      `SELECT u.id::text, u.display_name, u.email, u.is_active
       FROM users u
       WHERE u.user_type IN ('buyer', 'both')
         AND (
           lower(u.display_name) LIKE $1
           OR lower(u.email) LIKE $1
           OR lower(u.id::text) LIKE $1
           OR lower('cust-' || substring(u.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
           OR regexp_replace(lower(u.id::text), '[^a-z0-9]', '', 'g') LIKE $2
         )
       ORDER BY u.updated_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
    safeQuery<{
      id: string;
      name: string;
      seller_id: string;
      seller_name: string | null;
      seller_email: string;
      is_active: boolean;
    }>(
      "foods",
      `SELECT
         f.id::text,
         f.name,
         s.id::text AS seller_id,
         s.display_name AS seller_name,
         s.email AS seller_email,
         f.is_active
       FROM foods f
       JOIN users s ON s.id = f.seller_id
       WHERE
         lower(f.name) LIKE $1
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(f.menu_items_json, '[]'::jsonb)) AS mi
           WHERE lower(COALESCE(mi ->> 'name', '')) LIKE $1
         )
         OR lower(f.id::text) LIKE $1
         OR lower('FD-' || substring(f.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
         OR regexp_replace(lower(f.id::text), '[^a-z0-9]', '', 'g') LIKE $2
       ORDER BY f.updated_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
    safeQuery<{
      id: string;
      status: string;
      buyer_id: string;
      seller_id: string;
      buyer_name: string | null;
      buyer_email: string | null;
      seller_name: string | null;
      seller_email: string | null;
      provider_reference_id: string | null;
      provider_session_id: string | null;
      created_at: string;
    }>(
      "orders",
      `SELECT
         o.id::text,
         o.status,
         o.buyer_id::text,
         o.seller_id::text,
         b.display_name AS buyer_name,
         b.email AS buyer_email,
         s.display_name AS seller_name,
         s.email AS seller_email,
         pa.provider_reference_id,
         pa.provider_session_id,
         o.created_at::text
       FROM orders o
       JOIN users b ON b.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
       LEFT JOIN LATERAL (
         SELECT provider_reference_id, provider_session_id
         FROM payment_attempts
         WHERE order_id = o.id
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1
       ) pa ON TRUE
       WHERE
         lower(o.id::text) LIKE $1
         OR lower('#' || substring(o.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
         OR lower('ord-' || substring(o.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
         OR lower('order-' || substring(o.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
         OR lower(o.status) LIKE $1
         OR lower(coalesce(b.display_name, '')) LIKE $1
         OR lower(coalesce(b.email, '')) LIKE $1
         OR lower(coalesce(s.display_name, '')) LIKE $1
         OR lower(coalesce(s.email, '')) LIKE $1
         OR lower(coalesce(pa.provider_reference_id, '')) LIKE $1
         OR lower(coalesce(pa.provider_session_id, '')) LIKE $1
         OR regexp_replace(lower(o.id::text), '[^a-z0-9]', '', 'g') LIKE $2
         OR regexp_replace(lower(coalesce(pa.provider_reference_id, '')), '[^a-z0-9]', '', 'g') LIKE $2
         OR regexp_replace(lower(coalesce(pa.provider_session_id, '')), '[^a-z0-9]', '', 'g') LIKE $2
       ORDER BY o.created_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
    safeQuery<{
      id: string;
      lot_number: string;
      food_id: string;
      food_name: string | null;
      seller_id: string;
      seller_name: string | null;
      seller_email: string | null;
      status: string;
      created_at: string;
    }>(
      "lots",
      `SELECT
         l.id::text,
         l.lot_number,
         l.food_id::text,
         f.name AS food_name,
         l.seller_id::text,
         s.display_name AS seller_name,
         s.email AS seller_email,
         l.status,
         l.created_at::text
       FROM production_lots l
       LEFT JOIN foods f ON f.id = l.food_id
       LEFT JOIN users s ON s.id = l.seller_id
       WHERE
         lower(l.lot_number) LIKE $1
         OR lower('lot-' || l.lot_number) LIKE $1
         OR lower(l.id::text) LIKE $1
         OR lower(coalesce(f.name, '')) LIKE $1
         OR regexp_replace(lower(l.lot_number), '[^a-z0-9]', '', 'g') LIKE $2
         OR regexp_replace(lower(l.id::text), '[^a-z0-9]', '', 'g') LIKE $2
       ORDER BY l.created_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
    safeQuery<{
      id: string;
      description: string | null;
      status: string;
      order_id: string;
      complainant_type: "buyer" | "seller";
      complainant_id: string;
      complainant_name: string | null;
      complainant_email: string | null;
      created_at: string;
    }>(
      "complaints",
      `SELECT
         c.id::text,
         c.description,
         c.status,
         c.order_id::text,
         ${COMPLAINANT_TYPE_SQL} AS complainant_type,
         COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) AS complainant_id,
         actor.display_name AS complainant_name,
         actor.email AS complainant_email,
         c.created_at::text
       FROM complaints c
       LEFT JOIN users actor ON actor.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
       WHERE
         lower(c.id::text) LIKE $1
         OR lower(c.order_id::text) LIKE $1
         OR lower('#' || substring(c.order_id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $1
         OR lower(coalesce(c.description, '')) LIKE $1
         OR regexp_replace(lower(c.id::text), '[^a-z0-9]', '', 'g') LIKE $2
         OR regexp_replace(lower(c.order_id::text), '[^a-z0-9]', '', 'g') LIKE $2
       ORDER BY c.created_at DESC
       LIMIT $3`,
      [needle, compactNeedle, perKindLimit]
    ),
  ]);

  const allKinds = [
    sellers.rows.map((row) => ({
      kind: "seller",
      id: row.id,
      primaryText: row.display_name || row.email,
      secondaryText: `${row.email} • ${row.is_active ? "active" : "disabled"} • CUST-${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      targetPath: `/app/sellers/${row.id}`,
    })),
    buyers.rows.map((row) => ({
      kind: "buyer",
      id: row.id,
      primaryText: row.display_name || row.email,
      secondaryText: `${row.email} • ${row.is_active ? "active" : "disabled"} • CUST-${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      targetPath: `/app/buyers/${row.id}`,
    })),
    foods.rows.map((row) => ({
      kind: "food",
      id: row.id,
      primaryText: row.name,
      secondaryText: `${row.seller_name || row.seller_email} • ${row.is_active ? "active" : "disabled"} • FD-${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      targetPath: `/app/sellers/${row.seller_id}?tab=foods&focusFoodId=${encodeURIComponent(row.id)}`,
    })),
    orders.rows.map((row) => {
      const ref = String(row.provider_reference_id ?? "");
      const session = String(row.provider_session_id ?? "");
      const refLower = ref.toLowerCase();
      const sessionLower = session.toLowerCase();
      const refCompact = refLower.replace(/[^a-z0-9]/g, "");
      const sessionCompact = sessionLower.replace(/[^a-z0-9]/g, "");
      const matchedTx =
        (normalized.length > 0 && refLower.includes(normalized) ? ref : "")
        || (normalized.length > 0 && sessionLower.includes(normalized) ? session : "")
        || (compact.length > 0 && refCompact.includes(compact) ? ref : "")
        || (compact.length > 0 && sessionCompact.includes(compact) ? session : "");
      const walletTarget = matchedTx
        ? `/app/sellers/${row.seller_id}?tab=wallet&searchTx=${encodeURIComponent(matchedTx)}`
        : `/app/orders?search=${encodeURIComponent(row.id)}`;
      return {
        kind: "order" as const,
        id: row.id,
        primaryText: `#${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
        secondaryText: `${row.status} • ${row.buyer_name || row.buyer_email || "buyer"} • ${row.seller_name || row.seller_email || "seller"} • ${row.created_at.slice(0, 10)}${row.provider_reference_id ? ` • Ref: ${row.provider_reference_id}` : ""}${row.provider_session_id ? ` • Session: ${row.provider_session_id}` : ""}`,
        targetPath: walletTarget,
      };
    }),
    lots.rows.map((row) => ({
      kind: "lot",
      id: row.id,
      primaryText: row.lot_number,
      secondaryText: `${row.food_name || "food"} • ${row.seller_name || row.seller_email || "seller"} • ${row.status}`,
      targetPath: `/app/sellers/${row.seller_id}?tab=foods&focusFoodId=${encodeURIComponent(row.food_id)}&focusLotId=${encodeURIComponent(row.id)}`,
    })),
    complaints.rows.map((row) => ({
      kind: "complaint",
      id: row.id,
      primaryText: row.description?.trim() || `Complaint #${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      secondaryText: `${row.status} • order #${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()} • ${row.complainant_name || row.complainant_email || row.complainant_type}`,
      targetPath: `/app/investigation/${row.id}`,
    })),
  ];

  // Interleave results across all kinds so every entity type gets fair representation.
  // Without interleaving, a flat concat + slice(0, limit) would cut off orders/lots/complaints
  // when sellers/buyers/foods already fill the limit.
  const data: (typeof allKinds)[0] = [];
  for (let i = 0; data.length < input.limit; i++) {
    let added = false;
    for (const kindArr of allKinds) {
      if (i < kindArr.length) {
        data.push(kindArr[i]);
        added = true;
        if (data.length >= input.limit) break;
      }
    }
    if (!added) break;
  }

  return res.json({ data });
});

adminUserManagementRouter.get("/users", requireAuth("admin"), async (req, res) => {
  const parsed = AppUserListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];

  if (input.status) {
    params.push(input.status === "active");
    where.push(`u.is_active = $${params.length}`);
  }

  if (input.userType) {
    params.push(input.userType);
    where.push(`u.user_type = $${params.length}`);
  } else if (input.audience === "buyer") {
    params.push("buyer");
    params.push("both");
    where.push(`u.user_type IN ($${params.length - 1}, $${params.length})`);
  } else if (input.audience === "seller") {
    params.push("seller");
    params.push("both");
    where.push(`u.user_type IN ($${params.length - 1}, $${params.length})`);
  }

  if (input.audience === "buyer" && input.smartFilter) {
    where.push(buyerSmartFilterConditionSql(input.smartFilter));
  }

  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`);
    const searchParamIndex = params.length;
    where.push(
      `(lower(u.email) LIKE $${searchParamIndex}
        OR lower(coalesce(u.phone, '')) LIKE $${searchParamIndex}
        OR lower(u.display_name) LIKE $${searchParamIndex}
        OR lower(u.id::text) LIKE $${searchParamIndex}
        OR lower('cust-' || u.id::text) LIKE $${searchParamIndex}
        OR lower('cust-' || substring(u.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $${searchParamIndex}
        OR EXISTS (
          SELECT 1
          FROM foods seller_food
          WHERE seller_food.seller_id = u.id
            AND (
              lower(seller_food.name) LIKE $${searchParamIndex}
              OR lower(seller_food.id::text) LIKE $${searchParamIndex}
              OR lower('FD-' || seller_food.id::text) LIKE $${searchParamIndex}
              OR lower('FD-' || substring(seller_food.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $${searchParamIndex}
            )
        )
        OR EXISTS (
          SELECT 1
          FROM orders buyer_orders
          JOIN order_items buyer_order_items ON buyer_order_items.order_id = buyer_orders.id
          JOIN foods buyer_food ON buyer_food.id = buyer_order_items.food_id
          WHERE buyer_orders.buyer_id = u.id
            AND (
              lower(buyer_food.name) LIKE $${searchParamIndex}
              OR lower(buyer_food.id::text) LIKE $${searchParamIndex}
              OR lower('FD-' || buyer_food.id::text) LIKE $${searchParamIndex}
              OR lower('FD-' || substring(buyer_food.id::text, 1, ${DISPLAY_ID_LENGTH})) LIKE $${searchParamIndex}
            )
        ))`
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (input.page - 1) * input.pageSize;
  const sortField = appSortFieldMap[input.sortBy];
  const sortDir = input.sortDir === "asc" ? "ASC" : "DESC";
  const complaintTotalSelect =
    input.audience === "seller" ? "COALESCE(complaint_received_stats.complaint_total, 0)::int" : "COALESCE(complaint_made_stats.complaint_total, 0)::int";
  const complaintResolvedSelect =
    input.audience === "seller"
      ? "COALESCE(complaint_received_stats.complaint_resolved, 0)::int"
      : "COALESCE(complaint_made_stats.complaint_resolved, 0)::int";
  const complaintUnresolvedSelect =
    input.audience === "seller"
      ? "COALESCE(complaint_received_stats.complaint_unresolved, 0)::int"
      : "COALESCE(complaint_made_stats.complaint_unresolved, 0)::int";
  const latestComplaintWhereSql =
    input.audience === "seller"
      ? "o.seller_id = u.id"
      : `COALESCE(c.complainant_user_id, c.complainant_buyer_id) = u.id AND ${COMPLAINANT_TYPE_SQL} = 'buyer'`;
  const orderStatsWhereSql = input.audience === "seller" ? "o.seller_id = u.id" : "o.buyer_id = u.id";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users u ${whereSql}`,
    params
  );

  const listParams = [...params, input.pageSize, offset];
  const list = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    profile_image_url: string | null;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
    legal_hold_state: boolean;
    country_code: string | null;
    language: string | null;
    created_at: string;
    updated_at: string;
    total_foods: number;
    complaint_total: number;
    complaint_resolved: number;
    complaint_unresolved: number;
    complaint_made_total: number;
    complaint_made_resolved: number;
    complaint_made_unresolved: number;
    monthly_order_count_current: number;
    monthly_order_count_previous: number;
    monthly_spent_current: string;
    monthly_spent_previous: string;
    last_online_at: string | null;
    latest_complaint_id: string | null;
    latest_complaint_description: string | null;
    latest_complaint_status: string | null;
    latest_complaint_created_at: string | null;
    latest_complaint_category_name: string | null;
    latest_complaint_seller_id: string | null;
    latest_complaint_seller_name: string | null;
    latest_complaint_seller_email: string | null;
    recent_login_count_24h: number;
    recent_login_ip_count_24h: number;
    recent_login_primary_ip: string | null;
    recent_login_shared_ip: string | null;
    recent_login_location_spread: boolean;
    avg_rating: string | null;
    avg_rating_current: string | null;
    avg_rating_previous: string | null;
    review_count: string;
  }>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.full_name,
       u.phone,
       u.dob::text,
       u.profile_image_url,
       u.user_type,
       u.is_active,
       CASE WHEN lower(COALESCE(to_jsonb(u) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
       u.country_code,
       u.language,
       u.created_at::text,
       u.updated_at::text,
       COALESCE(food_stats.total_foods, 0)::int AS total_foods,
       ${complaintTotalSelect} AS complaint_total,
       ${complaintResolvedSelect} AS complaint_resolved,
       ${complaintUnresolvedSelect} AS complaint_unresolved,
       COALESCE(complaint_made_stats.complaint_total, 0)::int AS complaint_made_total,
       COALESCE(complaint_made_stats.complaint_resolved, 0)::int AS complaint_made_resolved,
       COALESCE(complaint_made_stats.complaint_unresolved, 0)::int AS complaint_made_unresolved,
       COALESCE(order_stats.monthly_order_count_current, 0)::int AS monthly_order_count_current,
       COALESCE(order_stats.monthly_order_count_previous, 0)::int AS monthly_order_count_previous,
       COALESCE(order_stats.monthly_spent_current, 0)::text AS monthly_spent_current,
       COALESCE(order_stats.monthly_spent_previous, 0)::text AS monthly_spent_previous,
       COALESCE(
         presence_stats.last_online_at,
         (
           SELECT max(s.last_used_at)::text
           FROM auth_sessions s
           WHERE s.user_id = u.id
         )
       ) AS last_online_at,
       latest_complaint.id AS latest_complaint_id,
       latest_complaint.description AS latest_complaint_description,
       latest_complaint.status AS latest_complaint_status,
       latest_complaint.created_at AS latest_complaint_created_at,
       latest_complaint.category_name AS latest_complaint_category_name,
       latest_complaint.seller_id AS latest_complaint_seller_id,
       latest_complaint.seller_name AS latest_complaint_seller_name,
       latest_complaint.seller_email AS latest_complaint_seller_email,
       COALESCE(login_stats.recent_login_count_24h, 0)::int AS recent_login_count_24h,
       COALESCE(login_stats.recent_login_ip_count_24h, 0)::int AS recent_login_ip_count_24h,
       login_stats.recent_login_primary_ip,
       login_stats.recent_login_shared_ip,
       COALESCE(login_stats.recent_login_location_spread, FALSE) AS recent_login_location_spread,
       review_stats.avg_rating,
       review_stats.avg_rating_current,
       review_stats.avg_rating_previous,
       COALESCE(review_stats.review_count, '0') AS review_count
     FROM users u
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total_foods
       FROM foods f
       WHERE f.seller_id = u.id
     ) food_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS complaint_total,
         count(*) FILTER (WHERE c.status IN ('resolved', 'closed'))::int AS complaint_resolved,
         count(*) FILTER (WHERE c.status IN ('open', 'in_review'))::int AS complaint_unresolved
       FROM complaints c
       WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer'
         AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = u.id
     ) complaint_made_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS complaint_total,
         count(*) FILTER (WHERE c.status IN ('resolved', 'closed'))::int AS complaint_resolved,
         count(*) FILTER (WHERE c.status IN ('open', 'in_review'))::int AS complaint_unresolved
       FROM complaints c
       JOIN orders o ON o.id = c.order_id
       WHERE o.seller_id = u.id
     ) complaint_received_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         count(*) FILTER (WHERE o.created_at >= (now() - interval '30 days'))::int AS monthly_order_count_current,
         count(*) FILTER (WHERE o.created_at < (now() - interval '30 days') AND o.created_at >= (now() - interval '60 days'))::int AS monthly_order_count_previous,
         COALESCE(sum(CASE WHEN o.payment_completed = TRUE AND o.created_at >= (now() - interval '30 days') THEN o.total_price ELSE 0 END), 0) AS monthly_spent_current,
         COALESCE(sum(CASE WHEN o.payment_completed = TRUE AND o.created_at < (now() - interval '30 days') AND o.created_at >= (now() - interval '60 days') THEN o.total_price ELSE 0 END), 0) AS monthly_spent_previous
       FROM orders o
       WHERE ${orderStatsWhereSql}
     ) order_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT max(p.happened_at)::text AS last_online_at
       FROM user_presence_events p
       WHERE p.subject_type = 'app_user'
         AND p.subject_id = u.id
     ) presence_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS recent_login_count_24h,
         count(DISTINCT COALESCE(NULLIF(ul.ip, ''), 'no-ip'))::int AS recent_login_ip_count_24h,
         (
           array_agg(NULLIF(ul.ip, '') ORDER BY ul.created_at DESC)
           FILTER (WHERE NULLIF(ul.ip, '') IS NOT NULL)
         )[1] AS recent_login_primary_ip,
         (
           array_agg(DISTINCT NULLIF(ul.ip, ''))
           FILTER (
             WHERE NULLIF(ul.ip, '') IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM user_login_locations ul2
                 WHERE ul2.ip = ul.ip
                   AND ul2.user_id <> u.id
                   AND ul2.created_at >= (now() - interval '24 hours')
               )
           )
         )[1] AS recent_login_shared_ip,
         (
           (max(ul.latitude) - min(ul.latitude)) > 1
           OR (max(ul.longitude) - min(ul.longitude)) > 1
         ) AS recent_login_location_spread
       FROM user_login_locations ul
       WHERE ul.user_id = u.id
         AND ul.created_at >= (now() - interval '24 hours')
     ) login_stats ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         c.id::text AS id,
         c.description,
         c.status,
         c.created_at::text AS created_at,
         cat.name AS category_name,
         o.seller_id::text AS seller_id,
         s.display_name AS seller_name,
         s.email AS seller_email
       FROM complaints c
       JOIN orders o ON o.id = c.order_id
       LEFT JOIN users s ON s.id = o.seller_id
       LEFT JOIN complaint_categories cat ON cat.id = c.category_id
       WHERE ${latestComplaintWhereSql}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 1
     ) latest_complaint ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         avg(r.rating)::numeric(3,2) AS avg_rating,
         avg(r.rating) FILTER (WHERE r.created_at >= now() - interval '30 days')::numeric(3,2) AS avg_rating_current,
         avg(r.rating) FILTER (WHERE r.created_at < now() - interval '30 days' AND r.created_at >= now() - interval '60 days')::numeric(3,2) AS avg_rating_previous,
         count(*)::text AS review_count
       FROM reviews r
       WHERE r.seller_id = u.id
     ) review_stats ON TRUE
     ${whereSql}
     ORDER BY ${sortField} ${sortDir}, u.id ${sortDir}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const totalCount = Number(total.rows[0].count);
  return res.json({
    data: list.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      fullName: row.full_name,
      phone: row.phone,
      dob: row.dob,
      profileImageUrl: row.profile_image_url,
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      legalHoldState: row.legal_hold_state,
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalFoods: Number(row.total_foods ?? 0),
      complaintTotal: Number(row.complaint_total ?? 0),
      complaintResolved: Number(row.complaint_resolved ?? 0),
      complaintUnresolved: Number(row.complaint_unresolved ?? 0),
      complaintMadeTotal: Number(row.complaint_made_total ?? 0),
      complaintMadeResolved: Number(row.complaint_made_resolved ?? 0),
      complaintMadeUnresolved: Number(row.complaint_made_unresolved ?? 0),
      monthlyOrderCountCurrent: Number(row.monthly_order_count_current ?? 0),
      monthlyOrderCountPrevious: Number(row.monthly_order_count_previous ?? 0),
      monthlySpentCurrent: Number(row.monthly_spent_current ?? 0),
      monthlySpentPrevious: Number(row.monthly_spent_previous ?? 0),
      lastOnlineAt: row.last_online_at,
      latestComplaintId: row.latest_complaint_id,
      latestComplaintSubject: row.latest_complaint_description,
      latestComplaintDescription: row.latest_complaint_description,
      latestComplaintStatus: row.latest_complaint_status,
      latestComplaintCreatedAt: row.latest_complaint_created_at,
      latestComplaintCategoryName: row.latest_complaint_category_name,
      latestComplaintSellerId: row.latest_complaint_seller_id,
      latestComplaintSellerName: row.latest_complaint_seller_name,
      latestComplaintSellerEmail: row.latest_complaint_seller_email,
      recentLoginCount24h: Number(row.recent_login_count_24h ?? 0),
      recentLoginIpCount24h: Number(row.recent_login_ip_count_24h ?? 0),
      recentLoginPrimaryIp: row.recent_login_primary_ip,
      recentLoginSharedIp: row.recent_login_shared_ip,
      recentLoginLocationSpread: Boolean(row.recent_login_location_spread),
      avgRating: row.avg_rating !== null ? Number(row.avg_rating) : null,
      reviewCount: Number(row.review_count ?? 0),
      ratingTrend: row.avg_rating_current !== null && row.avg_rating_previous !== null
        ? Number(row.avg_rating_current) - Number(row.avg_rating_previous)
        : null,
    })),
    pagination: {
      mode: "offset",
      page: input.page,
      pageSize: input.pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    },
  });
});

adminUserManagementRouter.get("/buyers/smart-filter-counts", requireAuth("admin"), async (_req, res) => {
  const buyerScopeSql = `u.user_type IN ('buyer', 'both')`;
  const dailyBuyerSql = buyerSmartFilterConditionSql("daily_buyer");
  const topRevenueSql = buyerSmartFilterConditionSql("top_revenue");
  const suspiciousLoginSql = buyerSmartFilterConditionSql("suspicious_login");
  const sameIpSql = buyerSmartFilterConditionSql("same_ip_multi_account");
  const complainersSql = buyerSmartFilterConditionSql("complainers");

  const counts = await pool.query<{
    daily_buyer: number;
    top_revenue: number;
    suspicious_login: number;
    same_ip_multi_account: number;
    complainers: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE ${buyerScopeSql} AND ${dailyBuyerSql})::int AS daily_buyer,
       count(*) FILTER (WHERE ${buyerScopeSql} AND ${topRevenueSql})::int AS top_revenue,
       count(*) FILTER (WHERE ${buyerScopeSql} AND ${suspiciousLoginSql})::int AS suspicious_login,
       count(*) FILTER (WHERE ${buyerScopeSql} AND ${sameIpSql})::int AS same_ip_multi_account,
       count(*) FILTER (WHERE ${buyerScopeSql} AND ${complainersSql})::int AS complainers
     FROM users u`
  );

  return res.json({
    data: {
      daily_buyer: Number(counts.rows[0]?.daily_buyer ?? 0),
      top_revenue: Number(counts.rows[0]?.top_revenue ?? 0),
      suspicious_login: Number(counts.rows[0]?.suspicious_login ?? 0),
      same_ip_multi_account: Number(counts.rows[0]?.same_ip_multi_account ?? 0),
      complainers: Number(counts.rows[0]?.complainers ?? 0),
    },
  });
});

adminUserManagementRouter.get("/users/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const user = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    profile_image_url: string | null;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
    legal_hold_state: boolean;
    country_code: string | null;
    language: string | null;
    created_at: string;
    updated_at: string;
    total_foods: number;
    avg_rating: string | null;
    review_count: string;
  }>(
    `SELECT
       users.id,
       email,
       display_name,
       full_name,
       phone,
       dob::text,
       profile_image_url,
       user_type,
       is_active,
       CASE WHEN lower(COALESCE(to_jsonb(users) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
       country_code,
       language,
       created_at::text,
       updated_at::text,
       (
         SELECT count(*)::int
         FROM foods f
         WHERE f.seller_id = users.id
       ) AS total_foods,
       (SELECT avg(r.rating)::numeric(3,2) FROM reviews r WHERE r.seller_id = users.id) AS avg_rating,
       (SELECT count(*)::text FROM reviews r WHERE r.seller_id = users.id) AS review_count
     FROM users
     WHERE id = $1`,
    [params.data.id]
  );

  if ((user.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }

  const row = user.rows[0];
  return res.json({
    data: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      fullName: row.full_name,
      phone: row.phone,
      dob: row.dob,
      profileImageUrl: row.profile_image_url,
      role: row.user_type,
      status: row.is_active ? "active" : "disabled",
      legalHoldState: row.legal_hold_state,
      countryCode: row.country_code,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      totalFoods: Number(row.total_foods ?? 0),
      avgRating: row.avg_rating !== null ? Number(row.avg_rating) : null,
      reviewCount: Number(row.review_count ?? 0),
    },
  });
});

adminUserManagementRouter.get("/users/:id/addresses", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const addresses = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, title, address_line, is_default, created_at::text, updated_at::text
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [params.data.id]
  );

  return res.json({
    data: addresses.rows.map((row) => ({
      id: row.id,
      title: row.title,
      addressLine: row.address_line,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

adminUserManagementRouter.post("/users/:id/addresses", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = CreateUserAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{
      id: string;
      title: string;
      address_line: string;
      is_default: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO user_addresses (user_id, title, address_line, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, address_line, is_default, created_at::text, updated_at::text`,
      [params.data.id, input.title, input.addressLine, Boolean(input.isDefault)]
    );

    const row = created.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "seller_address_created",
      entityType: "user_addresses",
      entityId: row.id,
      after: {
        userId: params.data.id,
        title: row.title,
        addressLine: row.address_line,
        isDefault: row.is_default,
      },
    });
    await client.query("COMMIT");

    return res.status(201).json({
      data: {
        id: row.id,
        title: row.title,
        addressLine: row.address_line,
        isDefault: row.is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/users/:id/addresses/:addressId", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UserAddressParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = UpdateUserAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      id: string;
      title: string;
      address_line: string;
      is_default: boolean;
    }>(
      `SELECT id, title, address_line, is_default
       FROM user_addresses
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [params.data.id, params.data.addressId]
    );
    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADDRESS_NOT_FOUND", message: "Address not found" } });
    }

    const updated = await client.query<{
      id: string;
      title: string;
      address_line: string;
      is_default: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE user_addresses
       SET
         title = CASE WHEN $3::boolean THEN $4 ELSE title END,
         address_line = CASE WHEN $5::boolean THEN $6 ELSE address_line END,
         is_default = CASE WHEN $7::boolean THEN $8 ELSE is_default END,
         updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING id, title, address_line, is_default, created_at::text, updated_at::text`,
      [
        params.data.id,
        params.data.addressId,
        Object.hasOwn(input, "title"),
        input.title ?? null,
        Object.hasOwn(input, "addressLine"),
        input.addressLine ?? null,
        Object.hasOwn(input, "isDefault"),
        typeof input.isDefault === "boolean" ? input.isDefault : null,
      ]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "seller_address_updated",
      entityType: "user_addresses",
      entityId: row.id,
      before: existing.rows[0],
      after: {
        title: row.title,
        addressLine: row.address_line,
        isDefault: row.is_default,
      },
    });
    await client.query("COMMIT");

    return res.json({
      data: {
        id: row.id,
        title: row.title,
        addressLine: row.address_line,
        isDefault: row.is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.delete("/users/:id/addresses/:addressId", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UserAddressParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deleted = await client.query<{
      id: string;
      title: string;
      address_line: string;
      is_default: boolean;
    }>(
      `DELETE FROM user_addresses
       WHERE user_id = $1 AND id = $2
       RETURNING id, title, address_line, is_default`,
      [params.data.id, params.data.addressId]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADDRESS_NOT_FOUND", message: "Address not found" } });
    }

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "seller_address_deleted",
      entityType: "user_addresses",
      entityId: deleted.rows[0].id,
      before: deleted.rows[0],
    });
    await client.query("COMMIT");

    return res.status(204).send();
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.get("/users/:id/seller-foods", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = SellerFoodsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM foods WHERE seller_id = $1",
    [params.data.id]
  );

  type SellerFoodListRow = {
    id: string;
    category_id: string | null;
    category_name: string | null;
    cuisine: string | null;
    name: string;
    card_summary: string | null;
    description: string | null;
    recipe: string | null;
    menu_items_json: unknown;
    ingredients_json: unknown;
    allergens_json: unknown;
    price: string;
    image_url: string | null;
    image_urls_json: unknown;
    active_lot_count: string;
    on_sale_quantity: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  };
  let rows;
  try {
    rows = await pool.query<SellerFoodListRow>(
      `SELECT
         f.id,
         f.category_id::text AS category_id,
         c.name_tr AS category_name,
         (to_jsonb(f)->>'cuisine') AS cuisine,
         f.name,
         (to_jsonb(f)->>'card_summary') AS card_summary,
         (to_jsonb(f)->>'description') AS description,
         (to_jsonb(f)->>'recipe') AS recipe,
         (to_jsonb(f)->'menu_items_json') AS menu_items_json,
         (to_jsonb(f)->'ingredients_json') AS ingredients_json,
         (to_jsonb(f)->'allergens_json') AS allergens_json,
         f.price::text,
         (to_jsonb(f)->>'image_url') AS image_url,
         (to_jsonb(f)->'image_urls_json') AS image_urls_json,
         COALESCE(lot_stats.active_lot_count, 0)::text AS active_lot_count,
         COALESCE(lot_stats.on_sale_quantity, 0)::text AS on_sale_quantity,
         f.is_active,
         f.created_at::text,
         f.updated_at::text
       FROM foods f
       LEFT JOIN categories c ON c.id = f.category_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (
             WHERE pl.status IN ('open', 'active')
               AND pl.quantity_available > 0
               AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= now())
               AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > now())
           )::int AS active_lot_count,
           COALESCE(SUM(pl.quantity_available) FILTER (
             WHERE pl.status IN ('open', 'active')
               AND pl.quantity_available > 0
               AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= now())
               AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > now())
           ), 0)::int AS on_sale_quantity
         FROM production_lots pl
         WHERE pl.food_id = f.id
       ) lot_stats ON TRUE
       WHERE f.seller_id = $1
       ORDER BY f.updated_at ${sortDir}, f.id ${sortDir}
       LIMIT $2 OFFSET $3`,
      [params.data.id, query.data.pageSize, offset]
    );
  } catch (error) {
    // Keep seller foods list available even if lot schema is not in sync on a server.
    rows = await pool.query<SellerFoodListRow>(
      `SELECT
         f.id,
         f.category_id::text AS category_id,
         c.name_tr AS category_name,
         (to_jsonb(f)->>'cuisine') AS cuisine,
         f.name,
         (to_jsonb(f)->>'card_summary') AS card_summary,
         (to_jsonb(f)->>'description') AS description,
         (to_jsonb(f)->>'recipe') AS recipe,
         (to_jsonb(f)->'menu_items_json') AS menu_items_json,
         (to_jsonb(f)->'ingredients_json') AS ingredients_json,
         (to_jsonb(f)->'allergens_json') AS allergens_json,
         f.price::text,
         (to_jsonb(f)->>'image_url') AS image_url,
         (to_jsonb(f)->'image_urls_json') AS image_urls_json,
         '0'::text AS active_lot_count,
         '0'::text AS on_sale_quantity,
         f.is_active,
         f.created_at::text,
         f.updated_at::text
       FROM foods f
       LEFT JOIN categories c ON c.id = f.category_id
       WHERE f.seller_id = $1
       ORDER BY f.updated_at ${sortDir}, f.id ${sortDir}
       LIMIT $2 OFFSET $3`,
      [params.data.id, query.data.pageSize, offset]
    );
    console.warn("[admin/users/:id/seller-foods] lot_stats skipped:", error);
  }

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: `FD-${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      categoryId: row.category_id,
      categoryName: row.category_name,
      cuisine: row.cuisine,
      menuItems: menuItemsFromJson(row.menu_items_json),
      secondaryCategories: [],
      cardSummary: row.card_summary,
      description: row.description,
      recipe: row.recipe,
      ingredients: ingredientsTextFromJson(row.ingredients_json),
      allergens: textItemsFromJson(row.allergens_json),
      price: Number(row.price),
      imageUrl: row.image_url,
      imageUrls: imageUrlsFromJson(row.image_urls_json, row.image_url),
      status: row.is_active ? "active" : "disabled",
      activeLotCount: Number(row.active_lot_count ?? 0),
      onSaleQuantity: Number(row.on_sale_quantity ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.patch("/users/:id/seller-foods/:foodId", requireAuth("admin"), async (req, res) => {
  const params = SellerFoodParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateSellerFoodSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<{
      id: string;
      seller_id: string;
      name: string;
      description: string | null;
      recipe: string | null;
      price: string;
      is_active: boolean;
    }>(
      `SELECT id::text, seller_id::text, name, description, recipe, price::text, is_active
       FROM foods
       WHERE id = $1 AND seller_id = $2
       FOR UPDATE`,
      [params.data.foodId, params.data.id]
    );

    if ((beforeResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(input.name.trim());
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${idx++}`);
      values.push(input.description === null ? null : input.description.trim() || null);
    }
    if (input.recipe !== undefined) {
      setClauses.push(`recipe = $${idx++}`);
      values.push(input.recipe === null ? null : input.recipe.trim() || null);
    }
    if (input.price !== undefined) {
      setClauses.push(`price = $${idx++}`);
      values.push(input.price);
    }
    if (input.isActive !== undefined) {
      setClauses.push(`is_active = $${idx++}`);
      values.push(input.isActive);
    }
    setClauses.push("updated_at = now()");

    values.push(params.data.foodId, params.data.id);
    const updated = await client.query<{
      id: string;
      seller_id: string;
      name: string;
      description: string | null;
      recipe: string | null;
      price: string;
      is_active: boolean;
      updated_at: string;
    }>(
      `UPDATE foods
       SET ${setClauses.join(", ")}
       WHERE id = $${idx++} AND seller_id = $${idx}
       RETURNING id::text, seller_id::text, name, description, recipe, price::text, is_active, updated_at::text`,
      values
    );

    const row = updated.rows[0];

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "seller_food_updated",
      entityType: "foods",
      entityId: row.id,
      before: beforeResult.rows[0],
      after: {
        id: row.id,
        sellerId: row.seller_id,
        name: row.name,
        description: row.description,
        recipe: row.recipe,
        price: Number(row.price),
        isActive: row.is_active,
        updatedAt: row.updated_at,
      },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        sellerId: row.seller_id,
        name: row.name,
        description: row.description,
        recipe: row.recipe,
        price: Number(row.price),
        isActive: row.is_active,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.get("/users/:id/seller-foods/export", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = SellerFoodsExportQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const scopedFoodIds = query.data.foodIds.length > 0
    ? query.data.foodIds
    : query.data.foodId
      ? [query.data.foodId]
      : [];

  const foods = await pool.query<{
    id: string;
    category_id: string | null;
    category_name: string | null;
    cuisine: string | null;
    name: string;
    recipe: string | null;
    ingredients_json: unknown;
    allergens_json: unknown;
    price: string;
    image_url: string | null;
    image_urls_json: unknown;
    is_active: boolean;
    updated_at: string;
  }>(
    `SELECT
       f.id,
       f.category_id::text AS category_id,
       c.name_tr AS category_name,
       f.cuisine,
       f.name,
       f.recipe,
       f.ingredients_json,
       f.allergens_json,
       f.price::text,
       f.image_url,
       f.image_urls_json,
       f.is_active,
       f.updated_at::text
     FROM foods f
     LEFT JOIN categories c ON c.id = f.category_id
     WHERE f.seller_id = $1
       AND ($2::uuid[] IS NULL OR f.id = ANY($2::uuid[]))
     ORDER BY f.updated_at DESC, f.id DESC`,
    [params.data.id, scopedFoodIds.length > 0 ? scopedFoodIds : null]
  );

  const lots = await pool.query<{
    id: string;
    food_id: string;
    lot_number: string;
    produced_at: string | null;
    sale_starts_at: string | null;
    sale_ends_at: string | null;
    recipe_snapshot: string | null;
    ingredients_snapshot_json: unknown;
    allergens_snapshot_json: unknown;
    quantity_produced: number;
    quantity_available: number;
    status: string;
  }>(
    `SELECT
       id::text,
       food_id::text,
       lot_number,
       produced_at::text,
       sale_starts_at::text,
       sale_ends_at::text,
       recipe_snapshot,
       ingredients_snapshot_json,
       allergens_snapshot_json,
       quantity_produced,
       quantity_available,
       status
     FROM production_lots
     WHERE seller_id = $1
       AND ($2::uuid[] IS NULL OR food_id = ANY($2::uuid[]))
     ORDER BY produced_at DESC, created_at DESC`,
    [params.data.id, scopedFoodIds.length > 0 ? scopedFoodIds : null]
  );

  const lotsByFoodId = new Map<string, typeof lots.rows>();
  for (const lot of lots.rows) {
    const current = lotsByFoodId.get(lot.food_id) ?? [];
    current.push(lot);
    lotsByFoodId.set(lot.food_id, current);
  }

  const worksheetRows = foods.rows.flatMap((food) => {
    const foodCode = `FD-${food.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`;
    const ingredientText = ingredientsTextFromJson(food.ingredients_json) ?? "";
    const ingredientItems = ingredientText
      .split(/[,;\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
    const lowerIngredients = ingredientItems.map((item) => item.toLocaleLowerCase("tr-TR"));
    const spiceHints = ["karabiber", "pul biber", "kimyon", "nane", "kekik", "isot", "paprika", "sumak", "tarcin", "yenibahar", "zerdecal"];
    const allergenHints = ["gluten", "un", "sut", "peynir", "yogurt", "yumurta", "balik", "karides", "midye", "susam", "fistik", "findik", "ceviz", "badem", "soya", "laktoz"];
    const spices = ingredientItems.filter((item, index) => spiceHints.some((hint) => lowerIngredients[index]?.includes(hint)));
    const allergens = ingredientItems.filter((item, index) => allergenHints.some((hint) => lowerIngredients[index]?.includes(hint)));
    const baseRow = {
      "Food ID": food.id,
      "Food Code": foodCode,
      Food: food.name,
      Category: food.category_name ?? "-",
      "Menu Items": "-",
      "Secondary Categories": "-",
      Cuisine: food.cuisine ?? "-",
      Status: food.is_active ? "Active" : "Disabled",
      Price: Number(food.price),
      "Primary Image": food.image_url ?? "-",
      "Image URLs": imageUrlsFromJson(food.image_urls_json, food.image_url).join(", ") || "-",
      "Updated At": food.updated_at,
      Ingredients: ingredientItems.join(", ") || "-",
      Spices: spices.join(", ") || "-",
      Allergens: allergens.join(", ") || "-",
    };
    const foodLots = lotsByFoodId.get(food.id) ?? [];
    if (foodLots.length === 0) {
      return [{ ...baseRow, "Lot No": "-", Lifecycle: "-", "Quantity (Available/Produced)": "-", "Produced At": "-", "Sale Window": "-", Snapshot: "No lot" }];
    }
    return foodLots.map((lot) => ({
      ...baseRow,
      "Lot No": lot.lot_number,
      Lifecycle: lotLifecycleForExport(lot.status, lot.sale_starts_at, lot.sale_ends_at),
      "Quantity (Available/Produced)": `${lot.quantity_available}/${lot.quantity_produced}`,
      "Produced At": lot.produced_at ?? "-",
      "Sale Window": `${lot.sale_starts_at ?? "-"} - ${lot.sale_ends_at ?? "-"}`,
      Snapshot: lotSnapshotSummary({
        foodRecipe: food.recipe,
        foodIngredients: food.ingredients_json,
        foodAllergens: food.allergens_json,
        lotRecipe: lot.recipe_snapshot,
        lotIngredients: lot.ingredients_snapshot_json,
        lotAllergens: lot.allergens_snapshot_json,
      }),
    }));
  });

  const buffer = createExcelXmlBuffer(worksheetRows, "Foods");
  const suffix = scopedFoodIds.length === 1 ? "food" : scopedFoodIds.length > 1 ? "selected-foods" : "foods";
  const fileName = `seller-${suffix}-${new Date().toISOString().slice(0, 10)}.xls`;
  res.setHeader("content-type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

adminUserManagementRouter.get("/buyers/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const [identity, summaryStats, latestOrders, risk] = await Promise.all([
    pool.query<{
      id: string;
      email: string;
      display_name: string;
      full_name: string | null;
      is_active: boolean;
    }>(
      `SELECT id, email, display_name, full_name, is_active
       FROM users
       WHERE id = $1`,
      [params.data.id]
    ),
    pool.query<{
      total_orders: string;
      total_spent: string;
      complaint_total: string;
      complaint_unresolved: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM orders o WHERE o.buyer_id = $1) AS total_orders,
         (SELECT COALESCE(sum(o.total_price), 0)::text FROM orders o WHERE o.buyer_id = $1 AND o.payment_completed = TRUE) AS total_spent,
         (SELECT count(*)::text FROM complaints c WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer' AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = $1) AS complaint_total,
         (SELECT count(*)::text FROM complaints c WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer' AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = $1 AND c.status IN ('open', 'in_review')) AS complaint_unresolved`,
      [params.data.id]
    ),
    pool.query<{
      id: string;
      status: string;
      total_price: string;
      created_at: string;
    }>(
      `SELECT id, status, total_price::text, created_at::text
       FROM orders
       WHERE buyer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [params.data.id]
    ),
    getBuyerRiskSnapshot(params.data.id),
  ]);

  const base = identity.rows[0];
  const summary = summaryStats.rows[0];

  return res.json({
    data: {
      id: base.id,
      name: base.full_name ?? base.display_name,
      email: base.email,
      risk_level: risk.riskLevel,
      risk_reasons: risk.riskReasons,
      status: base.is_active ? "active" : "disabled",
      contact_phone: null,
      last_orders: latestOrders.rows.map((row) => ({
        orderId: row.id,
        orderNo: `#${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
        status: row.status,
        totalAmount: Number(row.total_price),
        createdAt: row.created_at,
      })),
      payment_summary: {
        failed_payments_30d: risk.failedPayments,
      },
      complaints_summary: {
        total: Number(summary?.complaint_total ?? "0"),
        unresolved: Number(summary?.complaint_unresolved ?? "0"),
      },
      stats: {
        total_orders: Number(summary?.total_orders ?? "0"),
        total_spent: Number(summary?.total_spent ?? "0"),
      },
    },
  });
});

adminUserManagementRouter.get("/buyers/:id/risk", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const snapshot = await getBuyerRiskSnapshot(params.data.id);
  return res.json({
    data: {
      risk_level: snapshot.riskLevel,
      risk_reasons: snapshot.riskReasons,
      open_complaints: snapshot.openComplaints,
      cancellations_30d: snapshot.cancellations30d,
      failed_payments_30d: snapshot.failedPayments,
    },
  });
});

adminUserManagementRouter.post("/buyers/:id/send-sms", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerSmsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sms_logs (buyer_id, admin_id, message, status)
     VALUES ($1, $2, $3, 'queued')
     RETURNING id`,
    [params.data.id, req.auth!.userId, parsed.data.message.trim()]
  );

  return res.status(201).json({
    data: {
      success: true,
      log_id: inserted.rows[0]?.id,
      status: "queued",
    },
  });
});

adminUserManagementRouter.get("/buyers/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const query = BuyerNotesQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const rows = await pool.query<{
    id: string;
    buyer_id: string;
    admin_id: string;
    note: string;
    created_at: string;
    created_by_username: string | null;
  }>(
    `SELECT
       n.id,
       n.buyer_id,
       n.admin_id,
       n.note,
       n.created_at::text,
       split_part(a.email, '@', 1) AS created_by_username
     FROM buyer_notes n
     LEFT JOIN admin_users a ON a.id = n.admin_id
     WHERE n.buyer_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [params.data.id, query.data.limit]
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      buyerId: row.buyer_id,
      adminId: row.admin_id,
      note: row.note,
      createdAt: row.created_at,
      createdByUsername: row.created_by_username,
    })),
  });
});

adminUserManagementRouter.post("/buyers/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerNoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const inserted = await pool.query<{
    id: string;
    note: string;
    created_at: string;
    created_by_username: string | null;
  }>(
    `INSERT INTO buyer_notes (buyer_id, admin_id, note)
     VALUES ($1, $2, $3)
     RETURNING
       id,
       note,
       created_at::text,
       (SELECT split_part(email, '@', 1) FROM admin_users WHERE id = admin_id) AS created_by_username`,
    [params.data.id, req.auth!.userId, parsed.data.note.trim()]
  );

  return res.status(201).json({
    data: {
      id: inserted.rows[0]?.id,
      note: inserted.rows[0]?.note,
      createdAt: inserted.rows[0]?.created_at,
      createdByUsername: inserted.rows[0]?.created_by_username ?? null,
    },
  });
});

adminUserManagementRouter.patch("/buyers/:id/notes/:noteId", requireAuth("admin"), async (req, res) => {
  const params = BuyerNoteParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerNoteUpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const updated = await pool.query<{ id: string; note: string; created_at: string; created_by_username: string | null }>(
    `UPDATE buyer_notes
     SET note = $3
     WHERE buyer_id = $1 AND id = $2
     RETURNING
       id,
       note,
       created_at::text,
       (SELECT split_part(email, '@', 1) FROM admin_users WHERE id = admin_id) AS created_by_username`,
    [params.data.id, params.data.noteId, parsed.data.note.trim()]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
  }

  return res.json({
    data: {
      id: updated.rows[0]?.id,
      note: updated.rows[0]?.note,
      createdAt: updated.rows[0]?.created_at,
      createdByUsername: updated.rows[0]?.created_by_username ?? null,
    },
  });
});

adminUserManagementRouter.delete("/buyers/:id/notes/:noteId", requireAuth("admin"), async (req, res) => {
  const params = BuyerNoteParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM buyer_notes
     WHERE buyer_id = $1 AND id = $2
     RETURNING id`,
    [params.data.id, params.data.noteId]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.get("/buyers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const rows = await pool.query<{ id: string; tag: string }>(
    `SELECT id, tag
     FROM buyer_tags
     WHERE buyer_id = $1
     ORDER BY tag ASC`,
    [params.data.id]
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      tag: row.tag,
    })),
  });
});

adminUserManagementRouter.post("/buyers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerTagBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const tagValue = parsed.data.tag.trim();
  const inserted = await pool.query<{ id: string; tag: string }>(
    `INSERT INTO buyer_tags (buyer_id, tag)
     VALUES ($1, $2)
     ON CONFLICT (buyer_id, tag) DO UPDATE
     SET tag = EXCLUDED.tag
     RETURNING id, tag`,
    [params.data.id, tagValue]
  );

  return res.status(201).json({
    data: {
      id: inserted.rows[0]?.id,
      tag: inserted.rows[0]?.tag,
    },
  });
});

adminUserManagementRouter.delete("/buyers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerTagDeleteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM buyer_tags
     WHERE buyer_id = $1 AND tag = $2
     RETURNING id`,
    [params.data.id, parsed.data.tag.trim()]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "TAG_NOT_FOUND", message: "Tag not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.delete("/buyers/:id/tags/:tagId", requireAuth("admin"), async (req, res) => {
  const params = BuyerTagParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM buyer_tags
     WHERE buyer_id = $1 AND id = $2
     RETURNING id`,
    [params.data.id, params.data.tagId]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "TAG_NOT_FOUND", message: "Tag not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.get("/sellers/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const query = BuyerNotesQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const rows = await pool.query<{
    id: string;
    seller_id: string;
    admin_id: string;
    note: string;
    created_at: string;
    created_by_username: string | null;
  }>(
    `SELECT
       n.id,
       n.seller_id,
       n.admin_id,
       n.note,
       n.created_at::text,
       split_part(a.email, '@', 1) AS created_by_username
     FROM seller_notes n
     LEFT JOIN admin_users a ON a.id = n.admin_id
     WHERE n.seller_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [params.data.id, query.data.limit]
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      sellerId: row.seller_id,
      adminId: row.admin_id,
      note: row.note,
      createdAt: row.created_at,
      createdByUsername: row.created_by_username,
    })),
  });
});

adminUserManagementRouter.post("/sellers/:id/notes", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerNoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const inserted = await pool.query<{
    id: string;
    note: string;
    created_at: string;
    created_by_username: string | null;
  }>(
    `INSERT INTO seller_notes (seller_id, admin_id, note)
     VALUES ($1, $2, $3)
     RETURNING
       id,
       note,
       created_at::text,
       (SELECT split_part(email, '@', 1) FROM admin_users WHERE id = admin_id) AS created_by_username`,
    [params.data.id, req.auth!.userId, parsed.data.note.trim()]
  );

  return res.status(201).json({
    data: {
      id: inserted.rows[0]?.id,
      note: inserted.rows[0]?.note,
      createdAt: inserted.rows[0]?.created_at,
      createdByUsername: inserted.rows[0]?.created_by_username ?? null,
    },
  });
});

adminUserManagementRouter.patch("/sellers/:id/notes/:noteId", requireAuth("admin"), async (req, res) => {
  const params = BuyerNoteParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerNoteUpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const updated = await pool.query<{ id: string; note: string; created_at: string; created_by_username: string | null }>(
    `UPDATE seller_notes
     SET note = $3
     WHERE seller_id = $1 AND id = $2
     RETURNING
       id,
       note,
       created_at::text,
       (SELECT split_part(email, '@', 1) FROM admin_users WHERE id = admin_id) AS created_by_username`,
    [params.data.id, params.data.noteId, parsed.data.note.trim()]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
  }

  return res.json({
    data: {
      id: updated.rows[0]?.id,
      note: updated.rows[0]?.note,
      createdAt: updated.rows[0]?.created_at,
      createdByUsername: updated.rows[0]?.created_by_username ?? null,
    },
  });
});

adminUserManagementRouter.delete("/sellers/:id/notes/:noteId", requireAuth("admin"), async (req, res) => {
  const params = BuyerNoteParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM seller_notes
     WHERE seller_id = $1 AND id = $2
     RETURNING id`,
    [params.data.id, params.data.noteId]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.get("/sellers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const rows = await pool.query<{ id: string; tag: string }>(
    `SELECT id, tag
     FROM seller_tags
     WHERE seller_id = $1
     ORDER BY tag ASC`,
    [params.data.id]
  );

  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      tag: row.tag,
    })),
  });
});

adminUserManagementRouter.post("/sellers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerTagBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const tagValue = parsed.data.tag.trim();
  const inserted = await pool.query<{ id: string; tag: string }>(
    `INSERT INTO seller_tags (seller_id, tag)
     VALUES ($1, $2)
     ON CONFLICT (seller_id, tag) DO UPDATE
     SET tag = EXCLUDED.tag
     RETURNING id, tag`,
    [params.data.id, tagValue]
  );

  return res.status(201).json({
    data: {
      id: inserted.rows[0]?.id,
      tag: inserted.rows[0]?.tag,
    },
  });
});

adminUserManagementRouter.delete("/sellers/:id/tags", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }
  const parsed = BuyerTagDeleteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM seller_tags
     WHERE seller_id = $1 AND tag = $2
     RETURNING id`,
    [params.data.id, parsed.data.tag.trim()]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "TAG_NOT_FOUND", message: "Tag not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.delete("/sellers/:id/tags/:tagId", requireAuth("admin"), async (req, res) => {
  const params = BuyerTagParamsSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM seller_tags
     WHERE seller_id = $1 AND id = $2
     RETURNING id`,
    [params.data.id, params.data.tagId]
  );

  if (deleted.rowCount === 0) {
    return res.status(404).json({ error: { code: "TAG_NOT_FOUND", message: "Tag not found" } });
  }

  return res.status(204).send();
});

adminUserManagementRouter.get("/users/:id/buyer-orders", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    seller_id: string;
    seller_name: string | null;
    seller_email: string | null;
    delivery_type: string | null;
    requested_delivery_type: string | null;
    active_delivery_type: string | null;
    seller_decision_state: string | null;
    seller_eta_minutes: number | null;
    seller_promised_at: string | null;
    seller_delivery_note: string | null;
    seller_delivery_terms_snapshot: string | null;
    approved_at: string | null;
    payment_captured_at: string | null;
    delivery_address_json: unknown;
    status: string;
    total_price: string;
    payment_completed: boolean;
    created_at: string;
    updated_at: string;
    payment_status: string | null;
    payment_provider: string | null;
    payment_provider_reference_id: string | null;
    payment_provider_session_id: string | null;
    payment_updated_at: string | null;
    items_json: unknown;
  }>(
    `SELECT
       o.id,
       o.seller_id::text AS seller_id,
       su.display_name AS seller_name,
       su.email AS seller_email,
       o.delivery_type,
       o.requested_delivery_type,
       o.active_delivery_type,
       o.seller_decision_state,
       o.seller_eta_minutes,
       o.seller_promised_at::text AS seller_promised_at,
       o.seller_delivery_note,
       o.seller_delivery_terms_snapshot,
       o.approved_at::text AS approved_at,
       o.payment_captured_at::text AS payment_captured_at,
       o.delivery_address_json,
       o.status,
       o.total_price::text,
       o.payment_completed,
       o.created_at::text,
       o.updated_at::text,
       pa.status AS payment_status,
       pa.provider AS payment_provider,
       pa.provider_reference_id AS payment_provider_reference_id,
       pa.provider_session_id AS payment_provider_session_id,
       pa.updated_at::text AS payment_updated_at,
       COALESCE(items.items_json, '[]'::jsonb) AS items_json
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'orderItemId', oi.id,
           'foodId', f.id,
           'name', f.name,
           'imageUrl', f.image_url,
           'quantity', oi.quantity,
           'unitPrice', oi.unit_price,
           'lineTotal', oi.line_total,
           'selectedAddons', COALESCE(oi.selected_addons_json, '{"free":[],"paid":[]}'::jsonb)
         )
         ORDER BY oi.created_at ASC
       ) AS items_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) items ON TRUE
     LEFT JOIN LATERAL (
       SELECT status, provider, provider_reference_id, provider_session_id, updated_at
       FROM payment_attempts
       WHERE order_id = o.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) pa ON TRUE
     LEFT JOIN users su ON su.id = o.seller_id
     WHERE o.buyer_id = $1
     ORDER BY o.created_at ${sortDir}, o.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      orderId: row.id,
      orderNo: `#${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      deliveryType: normalizeDeliveryType(row.delivery_type) ?? row.delivery_type,
      requestedDeliveryType: normalizeDeliveryType(row.requested_delivery_type) ?? row.requested_delivery_type,
      activeDeliveryType: normalizeDeliveryType(row.active_delivery_type) ?? row.active_delivery_type,
      sellerDecisionState: row.seller_decision_state,
      sellerEtaMinutes: row.seller_eta_minutes,
      sellerPromisedAt: row.seller_promised_at,
      sellerDeliveryNote: row.seller_delivery_note,
      sellerDeliveryTermsSnapshot: row.seller_delivery_terms_snapshot,
      approvedAt: row.approved_at,
      paymentCapturedAt: row.payment_captured_at,
      deliveryAddress: row.delivery_address_json ?? null,
      status: row.status,
      totalAmount: Number(row.total_price),
      paymentCompleted: row.payment_completed,
      paymentStatus: row.payment_status ?? (row.payment_completed ? "succeeded" : "pending"),
      paymentProvider: row.payment_provider,
      paymentProviderReferenceId: row.payment_provider_reference_id,
      paymentProviderSessionId: row.payment_provider_session_id,
      paymentUpdatedAt: row.payment_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: Array.isArray(row.items_json) ? row.items_json : [],
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/seller-orders", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE seller_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    buyer_id: string;
    buyer_name: string | null;
    buyer_email: string | null;
    delivery_type: string | null;
    requested_delivery_type: string | null;
    active_delivery_type: string | null;
    seller_decision_state: string | null;
    seller_eta_minutes: number | null;
    seller_promised_at: string | null;
    seller_delivery_note: string | null;
    seller_delivery_terms_snapshot: string | null;
    approved_at: string | null;
    payment_captured_at: string | null;
    status: string;
    total_price: string;
    payment_completed: boolean;
    created_at: string;
    updated_at: string;
    payment_status: string | null;
    payment_provider: string | null;
    payment_provider_reference_id: string | null;
    payment_provider_session_id: string | null;
    payment_updated_at: string | null;
    items_json: unknown;
  }>(
    `SELECT
       o.id,
       o.buyer_id::text AS buyer_id,
       bu.display_name AS buyer_name,
       bu.email AS buyer_email,
       o.delivery_type,
       o.requested_delivery_type,
       o.active_delivery_type,
       o.seller_decision_state,
       o.seller_eta_minutes,
       o.seller_promised_at::text AS seller_promised_at,
       o.seller_delivery_note,
       o.seller_delivery_terms_snapshot,
       o.approved_at::text AS approved_at,
       o.payment_captured_at::text AS payment_captured_at,
       o.status,
       o.total_price::text,
       o.payment_completed,
       o.created_at::text,
       o.updated_at::text,
       pa.status AS payment_status,
       pa.provider AS payment_provider,
       pa.provider_reference_id AS payment_provider_reference_id,
       pa.provider_session_id AS payment_provider_session_id,
       pa.updated_at::text AS payment_updated_at,
       COALESCE(items.items_json, '[]'::jsonb) AS items_json
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'orderItemId', oi.id,
           'foodId', f.id,
           'name', f.name,
           'imageUrl', f.image_url,
           'quantity', oi.quantity,
           'unitPrice', oi.unit_price,
           'lineTotal', oi.line_total,
           'selectedAddons', COALESCE(oi.selected_addons_json, '{"free":[],"paid":[]}'::jsonb)
         )
         ORDER BY oi.created_at ASC
       ) AS items_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) items ON TRUE
     LEFT JOIN LATERAL (
       SELECT status, provider, provider_reference_id, provider_session_id, updated_at
       FROM payment_attempts
       WHERE order_id = o.id
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) pa ON TRUE
     LEFT JOIN users bu ON bu.id = o.buyer_id
     WHERE o.seller_id = $1
     ORDER BY o.created_at ${sortDir}, o.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      orderId: row.id,
      orderNo: `#${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      buyerId: row.buyer_id,
      buyerName: row.buyer_name,
      buyerEmail: row.buyer_email,
      deliveryType: normalizeDeliveryType(row.delivery_type) ?? row.delivery_type,
      requestedDeliveryType: normalizeDeliveryType(row.requested_delivery_type) ?? row.requested_delivery_type,
      activeDeliveryType: normalizeDeliveryType(row.active_delivery_type) ?? row.active_delivery_type,
      sellerDecisionState: row.seller_decision_state,
      sellerEtaMinutes: row.seller_eta_minutes,
      sellerPromisedAt: row.seller_promised_at,
      sellerDeliveryNote: row.seller_delivery_note,
      sellerDeliveryTermsSnapshot: row.seller_delivery_terms_snapshot,
      approvedAt: row.approved_at,
      paymentCapturedAt: row.payment_captured_at,
      status: row.status,
      totalAmount: Number(row.total_price),
      paymentCompleted: row.payment_completed,
      paymentStatus: row.payment_status ?? (row.payment_completed ? "succeeded" : "pending"),
      paymentProvider: row.payment_provider,
      paymentProviderReferenceId: row.payment_provider_reference_id,
      paymentProviderSessionId: row.payment_provider_session_id,
      paymentUpdatedAt: row.payment_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: Array.isArray(row.items_json) ? row.items_json : [],
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-summary", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const orderStats = await pool.query<{
    total_orders: string;
    total_spent: string;
    current_orders: string;
    previous_orders: string;
    current_spent: string;
    previous_spent: string;
  }>(
    `SELECT
       count(*)::text AS total_orders,
       COALESCE(sum(CASE WHEN payment_completed = TRUE THEN total_price ELSE 0 END), 0)::text AS total_spent,
       count(*) FILTER (WHERE created_at >= (now() - interval '30 days'))::text AS current_orders,
       count(*) FILTER (WHERE created_at < (now() - interval '30 days') AND created_at >= (now() - interval '60 days'))::text AS previous_orders,
       COALESCE(sum(CASE WHEN payment_completed = TRUE AND created_at >= (now() - interval '30 days') THEN total_price ELSE 0 END), 0)::text AS current_spent,
       COALESCE(sum(CASE WHEN payment_completed = TRUE AND created_at < (now() - interval '30 days') AND created_at >= (now() - interval '60 days') THEN total_price ELSE 0 END), 0)::text AS previous_spent
     FROM orders
     WHERE buyer_id = $1`,
    [params.data.id]
  );

  const complaintStats = await pool.query<{
    total_complaints: string;
    resolved_complaints: string;
    unresolved_complaints: string;
  }>(
     `SELECT
       count(*)::text AS total_complaints,
       count(*) FILTER (WHERE status IN ('resolved', 'closed'))::text AS resolved_complaints,
       count(*) FILTER (WHERE status IN ('open', 'in_review'))::text AS unresolved_complaints
     FROM complaints
     WHERE COALESCE(to_jsonb(complaints) ->> 'complainant_type', 'buyer') = 'buyer'
       AND COALESCE(complainant_user_id, complainant_buyer_id) = $1`,
    [params.data.id]
  );

  const orderRow = orderStats.rows[0];
  const complaintRow = complaintStats.rows[0];

  return res.json({
    data: {
      complaintTotal: Number(complaintRow?.total_complaints ?? "0"),
      complaintResolved: Number(complaintRow?.resolved_complaints ?? "0"),
      complaintUnresolved: Number(complaintRow?.unresolved_complaints ?? "0"),
      totalSpent: Number(orderRow?.total_spent ?? "0"),
      totalOrders: Number(orderRow?.total_orders ?? "0"),
      monthlyOrderCountCurrent: Number(orderRow?.current_orders ?? "0"),
      monthlyOrderCountPrevious: Number(orderRow?.previous_orders ?? "0"),
      monthlySpentCurrent: Number(orderRow?.current_spent ?? "0"),
      monthlySpentPrevious: Number(orderRow?.previous_spent ?? "0"),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-reviews", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM reviews WHERE buyer_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    order_id: string;
    food_id: string;
    food_name: string;
    food_image_url: string | null;
    seller_name: string | null;
    seller_email: string | null;
    rating: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       r.id,
       r.order_id,
       r.food_id,
       f.name AS food_name,
       f.image_url AS food_image_url,
       s.display_name AS seller_name,
       s.email AS seller_email,
       r.rating,
       r.comment,
       r.created_at::text,
       r.updated_at::text
     FROM reviews r
     JOIN foods f ON f.id = r.food_id
     LEFT JOIN users s ON s.id = r.seller_id
     WHERE r.buyer_id = $1
     ORDER BY r.created_at ${sortDir}, r.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      foodId: row.food_id,
      foodName: row.food_name,
      foodImageUrl: row.food_image_url,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

const SellerReviewsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

adminUserManagementRouter.get("/users/:id/seller-reviews", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = SellerReviewsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";
  const conditions: string[] = ["r.seller_id = $1"];
  const sqlParams: unknown[] = [params.data.id];

  if (query.data.rating !== undefined) {
    sqlParams.push(query.data.rating);
    conditions.push(`r.rating = $${sqlParams.length}`);
  }

  const whereClause = conditions.join(" AND ");

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM reviews r WHERE ${whereClause}`,
    sqlParams
  );

  sqlParams.push(query.data.pageSize, offset);
  const rows = await pool.query<{
    id: string;
    order_id: string;
    food_id: string;
    food_name: string;
    buyer_id: string;
    buyer_name: string | null;
    rating: number;
    comment: string | null;
    is_verified_purchase: boolean;
    created_at: string;
  }>(
    `SELECT
       r.id,
       r.order_id,
       r.food_id,
       f.name AS food_name,
       r.buyer_id,
       u.display_name AS buyer_name,
       r.rating,
       r.comment,
       r.is_verified_purchase,
       r.created_at::text
     FROM reviews r
     JOIN foods f ON f.id = r.food_id
     LEFT JOIN users u ON u.id = r.buyer_id
     WHERE ${whereClause}
     ORDER BY r.created_at ${sortDir}, r.id ${sortDir}
     LIMIT $${sqlParams.length - 1} OFFSET $${sqlParams.length}`,
    sqlParams
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      foodId: row.food_id,
      foodName: row.food_name,
      buyerId: row.buyer_id,
      buyerName: row.buyer_name,
      rating: row.rating,
      comment: row.comment,
      isVerifiedPurchase: row.is_verified_purchase,
      createdAt: row.created_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-complaints", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM complaints c
     WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer'
       AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = $1`,
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    order_id: string;
    description: string | null;
    category_id: string | null;
    category_code: string | null;
    category_name: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    status: "open" | "in_review" | "resolved" | "closed";
    created_at: string;
    resolved_at: string | null;
  }>(
    `SELECT
       c.id::text,
       c.order_id::text,
       c.description,
       c.category_id::text,
       cat.code AS category_code,
       cat.name AS category_name,
       c.priority,
       c.status,
       c.created_at::text,
       c.resolved_at::text
     FROM complaints c
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     WHERE ${COMPLAINANT_TYPE_SQL} = 'buyer'
       AND COALESCE(c.complainant_user_id, c.complainant_buyer_id) = $1
     ORDER BY c.created_at ${sortDir}, c.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      orderNo: `#${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      description: row.description,
      categoryId: row.category_id,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      priority: row.priority,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/seller-complaints", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const seller = await ensureSellerUser(params.data.id);
  if (!seller.ok) {
    return res.status(seller.status).json({ error: { code: seller.code, message: seller.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM complaints c
     JOIN orders o ON o.id = c.order_id
     WHERE o.seller_id = $1`,
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    order_id: string;
    description: string | null;
    category_code: string | null;
    category_name: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    status: "open" | "in_review" | "resolved" | "closed";
    complainant_name: string | null;
    created_at: string;
    resolved_at: string | null;
  }>(
    `SELECT
       c.id::text,
       c.order_id::text,
       c.description,
       cat.code AS category_code,
       cat.name AS category_name,
       c.priority,
       c.status,
       COALESCE(NULLIF(actor.display_name, ''), NULLIF(actor.full_name, ''), NULLIF(actor.email, '')) AS complainant_name,
       c.created_at::text,
       c.resolved_at::text
     FROM complaints c
     JOIN orders o ON o.id = c.order_id
     LEFT JOIN users actor ON actor.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     WHERE o.seller_id = $1
     ORDER BY c.created_at ${sortDir}, c.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      orderNo: `#${row.order_id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      description: row.description,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      priority: row.priority,
      status: row.status,
      complainantName: row.complainant_name,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-cancellations", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1 AND status = 'cancelled'",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    total_price: string;
    created_at: string;
    cancelled_at: string;
    cancel_reason: string | null;
    items_json: unknown;
  }>(
    `SELECT
       o.id,
       o.total_price::text,
       o.created_at::text,
       COALESCE(ce.created_at::text, o.updated_at::text) AS cancelled_at,
       COALESCE(ce.payload_json ->> 'reason', ce.payload_json ->> 'message') AS cancel_reason,
       COALESCE(items.items_json, '[]'::jsonb) AS items_json
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT payload_json, created_at
       FROM order_events
       WHERE order_id = o.id
         AND (to_status = 'cancelled' OR event_type ILIKE '%cancel%')
       ORDER BY created_at DESC
       LIMIT 1
     ) ce ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'orderItemId', oi.id,
           'foodId', f.id,
           'name', f.name,
           'imageUrl', f.image_url,
           'quantity', oi.quantity,
           'lineTotal', oi.line_total,
           'selectedAddons', COALESCE(oi.selected_addons_json, '{"free":[],"paid":[]}'::jsonb)
         )
         ORDER BY oi.created_at ASC
       ) AS items_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = o.id
     ) items ON TRUE
     WHERE o.buyer_id = $1
       AND o.status = 'cancelled'
     ORDER BY o.updated_at ${sortDir}, o.id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      orderId: row.id,
      orderNo: `#${row.id.slice(0, DISPLAY_ID_LENGTH).toUpperCase()}`,
      totalAmount: Number(row.total_price),
      cancelledAt: row.cancelled_at,
      reason: row.cancel_reason,
      items: Array.isArray(row.items_json) ? row.items_json : [],
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.get("/users/:id/buyer-contact", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const user = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    profile_image_url: string | null;
    is_active: boolean;
    country_code: string | null;
    language: string | null;
    phone: string | null;
    dob: string | null;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
  }>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.full_name,
       u.profile_image_url,
       u.is_active,
       u.country_code,
       u.language,
       u.phone,
       u.dob::text,
       u.created_at::text,
       u.updated_at::text,
       COALESCE(
         (
           SELECT max(p.happened_at)::text
           FROM user_presence_events p
           WHERE p.subject_type = 'app_user'
             AND p.subject_id = u.id
         ),
         (
           SELECT max(s.last_used_at)::text
           FROM auth_sessions s
           WHERE s.user_id = u.id
         )
       ) AS last_login_at
     FROM users u
     WHERE u.id = $1`,
    [params.data.id]
  );

  const addresses = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
  }>(
    `SELECT id, title, address_line, is_default, created_at::text
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [params.data.id]
  );

  const grouped = {
    home: null as null | { id: string; title: string; addressLine: string; isDefault: boolean },
    office: null as null | { id: string; title: string; addressLine: string; isDefault: boolean },
    other: [] as Array<{ id: string; title: string; addressLine: string; isDefault: boolean }>,
  };
  for (const item of addresses.rows) {
    const normalized = item.title.toLowerCase().trim();
    const mapped =
      normalized.includes("ev") || normalized.includes("home")
        ? "home"
        : normalized.includes("ofis") || normalized.includes("office") || normalized.includes("iş")
          ? "office"
          : "other";
    const payload = { id: item.id, title: item.title, addressLine: item.address_line, isDefault: item.is_default };
    if (mapped === "home" && !grouped.home) grouped.home = payload;
    else if (mapped === "office" && !grouped.office) grouped.office = payload;
    else grouped.other.push(payload);
  }

  const base = user.rows[0];
  return res.json({
    data: {
      identity: {
        id: base.id,
        email: base.email,
        displayName: base.display_name,
        fullName: base.full_name,
        profileImageUrl: base.profile_image_url,
        status: base.is_active ? "active" : "disabled",
        createdAt: base.created_at,
        updatedAt: base.updated_at,
        lastLoginAt: base.last_login_at,
      },
      contact: {
        phone: base.phone,
        dob: base.dob,
        countryCode: base.country_code,
        language: base.language,
      },
      addresses: grouped,
    },
  });
});

adminUserManagementRouter.get("/users/:id/login-locations", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const query = BuyerListQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: query.error.flatten() } });
  }

  const buyer = await ensureBuyerUser(params.data.id);
  if (!buyer.ok) {
    return res.status(buyer.status).json({ error: { code: buyer.code, message: buyer.message } });
  }

  const offset = (query.data.page - 1) * query.data.pageSize;
  const sortDir = query.data.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM user_login_locations WHERE user_id = $1",
    [params.data.id]
  );

  const rows = await pool.query<{
    id: string;
    session_id: string | null;
    latitude: string;
    longitude: string;
    accuracy_m: number | null;
    source: string;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
  }>(
    `SELECT
       id,
       session_id,
       latitude::text,
       longitude::text,
       accuracy_m,
       source,
       ip,
       user_agent,
       created_at::text
     FROM user_login_locations
     WHERE user_id = $1
     ORDER BY created_at ${sortDir}, id ${sortDir}
     LIMIT $2 OFFSET $3`,
    [params.data.id, query.data.pageSize, offset]
  );

  const totalCount = Number(total.rows[0]?.count ?? 0);
  return res.json({
    data: rows.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyM: row.accuracy_m,
      source: row.source,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    })),
    pagination: {
      mode: "offset",
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / query.data.pageSize)),
    },
  });
});

adminUserManagementRouter.post("/users", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = CreateAppUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const displayNameNormalized = normalizeDisplayName(input.displayName);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uniqueUsername = await ensureUniqueUsername(client, {
      email: input.email.toLowerCase(),
      displayName: input.displayName,
    });
    const created = await client.query(
      `INSERT INTO users (email, password_hash, display_name, display_name_normalized, username, username_normalized, full_name, phone, dob, profile_image_url, user_type, is_active, country_code, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14)
       RETURNING id, email, display_name, username, full_name, phone, dob::text, profile_image_url, user_type, is_active,
         CASE WHEN lower(COALESCE(to_jsonb(users) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
         country_code, language, created_at::text, updated_at::text`,
      [
        input.email.toLowerCase(),
        passwordHash,
        input.displayName,
        displayNameNormalized,
        uniqueUsername.username,
        uniqueUsername.usernameNormalized,
        input.fullName ?? null,
        input.phone ?? null,
        input.dob ?? null,
        input.profileImageUrl ?? null,
        input.userType,
        input.isActive ?? true,
        input.countryCode ?? null,
        input.language ?? null,
      ]
    );

    const row = created.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_created",
      entityType: "users",
      entityId: row.id,
      after: {
        email: row.email,
        displayName: row.display_name,
        phone: row.phone,
        dob: row.dob,
        userType: row.user_type,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        username: row.username,
        fullName: row.full_name,
        phone: row.phone,
        dob: row.dob,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        legalHoldState: row.legal_hold_state,
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.put("/users/:id", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, email, display_name, full_name, phone, dob::text, profile_image_url, user_type, is_active, country_code, language
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [params.data.id]
    );

    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const before = existing.rows[0];
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const displayNameNormalized = input.displayName ? normalizeDisplayName(input.displayName) : null;

    const updated = await client.query(
      `UPDATE users
       SET
         email = coalesce($2, email),
         password_hash = coalesce($3, password_hash),
         display_name = coalesce($4, display_name),
         display_name_normalized = coalesce($5, display_name_normalized),
         full_name = CASE WHEN $6::boolean THEN $7 ELSE full_name END,
         phone = CASE WHEN $8::boolean THEN $9 ELSE phone END,
         dob = CASE WHEN $10::boolean THEN $11::date ELSE dob END,
         profile_image_url = CASE WHEN $12::boolean THEN $13 ELSE profile_image_url END,
         user_type = coalesce($14, user_type),
         country_code = CASE WHEN $15::boolean THEN $16 ELSE country_code END,
         language = CASE WHEN $17::boolean THEN $18 ELSE language END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, phone, dob::text, profile_image_url, user_type, is_active,
         CASE WHEN lower(COALESCE(to_jsonb(users) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
         country_code, language, created_at::text, updated_at::text`,
      [
        params.data.id,
        input.email ? input.email.toLowerCase() : null,
        passwordHash,
        input.displayName ?? null,
        displayNameNormalized,
        Object.hasOwn(input, "fullName"),
        input.fullName ?? null,
        Object.hasOwn(input, "phone"),
        input.phone ?? null,
        Object.hasOwn(input, "dob"),
        input.dob ?? null,
        Object.hasOwn(input, "profileImageUrl"),
        input.profileImageUrl ?? null,
        input.userType ?? null,
        Object.hasOwn(input, "countryCode"),
        input.countryCode ?? null,
        Object.hasOwn(input, "language"),
        input.language ?? null,
      ]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_updated",
      entityType: "users",
      entityId: row.id,
      before,
      after: {
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        phone: row.phone,
        dob: row.dob,
        profileImageUrl: row.profile_image_url,
        userType: row.user_type,
        isActive: row.is_active,
        countryCode: row.country_code,
        language: row.language,
      },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        phone: row.phone,
        dob: row.dob,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        legalHoldState: row.legal_hold_state,
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/users/:id/status", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const nextActive = parsed.data.status === "active";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, is_active FROM users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );
    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const updated = await client.query(
      `UPDATE users
       SET is_active = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, phone, dob::text, profile_image_url, user_type, is_active,
         CASE WHEN lower(COALESCE(to_jsonb(users) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
         country_code, language, created_at::text, updated_at::text`,
      [params.data.id, nextActive]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_status_updated",
      entityType: "users",
      entityId: row.id,
      before: { isActive: before.rows[0].is_active },
      after: { isActive: row.is_active },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        phone: row.phone,
        dob: row.dob,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        legalHoldState: row.legal_hold_state,
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/users/:id/role", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAppUserRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, user_type FROM users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const updated = await client.query(
      `UPDATE users
       SET user_type = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, full_name, phone, dob::text, profile_image_url, user_type, is_active,
         CASE WHEN lower(COALESCE(to_jsonb(users) ->> 'legal_hold_state', '')) IN ('true','t','1','yes') THEN TRUE ELSE FALSE END AS legal_hold_state,
         country_code, language, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.role]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_user_role_updated",
      entityType: "users",
      entityId: row.id,
      before: { role: before.rows[0].user_type },
      after: { role: row.user_type },
    });

    await client.query("COMMIT");
    return res.json({
      data: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        fullName: row.full_name,
        phone: row.phone,
        dob: row.dob,
        profileImageUrl: row.profile_image_url,
        role: row.user_type,
        status: row.is_active ? "active" : "disabled",
        legalHoldState: row.legal_hold_state,
        countryCode: row.country_code,
        language: row.language,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.post("/users/:id/reset-test-password", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [params.data.id]);
    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    const testPassword = "12345678";
    const passwordHash = await hashPassword(testPassword);

    await client.query(
      `UPDATE users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1`,
      [params.data.id, passwordHash]
    );

    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "app_user_test_password_reset",
      entityType: "users",
      entityId: params.data.id,
      after: { passwordResetTo: testPassword },
    });

    await client.query("COMMIT");
    return res.status(200).json({ data: { id: params.data.id, password: testPassword } });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.get("/admin-users", requireAuth("admin"), async (req, res) => {
  const parsed = AdminUserListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];

  if (input.status) {
    params.push(input.status === "active");
    where.push(`a.is_active = $${params.length}`);
  }

  if (input.role) {
    params.push(input.role);
    where.push(`a.role = $${params.length}`);
  }

  if (input.search) {
    params.push(`%${input.search.toLowerCase()}%`);
    where.push(`lower(a.email) LIKE $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (input.page - 1) * input.pageSize;
  const sortField = adminSortFieldMap[input.sortBy];
  const sortDir = input.sortDir === "asc" ? "ASC" : "DESC";

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_users a ${whereSql}`,
    params
  );

  const listParams = [...params, input.pageSize, offset];
  const list = await pool.query<{
    id: string;
    email: string;
    role: "admin" | "super_admin";
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       a.id,
       a.email,
       a.role,
       a.is_active,
       COALESCE(
         (
           SELECT max(p.happened_at)::text
           FROM user_presence_events p
           WHERE p.subject_type = 'admin_user'
             AND p.subject_id = a.id
         ),
         a.last_login_at::text
       ) AS last_login_at,
       a.created_at::text,
       a.updated_at::text
     FROM admin_users a
     ${whereSql}
     ORDER BY ${sortField} ${sortDir}, a.id ${sortDir}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const totalCount = Number(total.rows[0].count);
  return res.json({
    data: list.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.is_active ? "active" : "disabled",
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      mode: "offset",
      page: input.page,
      pageSize: input.pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    },
  });
});

adminUserManagementRouter.get("/admin-users/:id", requireAuth("admin"), async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const adminUser = await pool.query<{
    id: string;
    email: string;
    role: "admin" | "super_admin";
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       id,
       email,
       role,
       is_active,
       COALESCE(
         (
           SELECT max(p.happened_at)::text
           FROM user_presence_events p
           WHERE p.subject_type = 'admin_user'
             AND p.subject_id = admin_users.id
         ),
         last_login_at::text
       ) AS last_login_at,
       created_at::text,
       updated_at::text
     FROM admin_users
     WHERE id = $1`,
    [params.data.id]
  );

  if ((adminUser.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
  }

  const row = adminUser.rows[0];
  return res.json({
    data: {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.is_active ? "active" : "disabled",
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

adminUserManagementRouter.post("/admin-users", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = CreateAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO admin_users (email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [input.email.toLowerCase(), passwordHash, input.role, input.isActive ?? true]
    );

    const row = created.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_created",
      entityType: "admin_users",
      entityId: row.id,
      after: {
        email: row.email,
        role: row.role,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.put("/admin-users/:id", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id, email, role, is_active FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((existing.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const updated = await client.query(
      `UPDATE admin_users
       SET
         email = coalesce($2, email),
         password_hash = coalesce($3, password_hash),
         updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, input.email ? input.email.toLowerCase() : null, passwordHash]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: existing.rows[0],
      after: {
        email: row.email,
        role: row.role,
        isActive: row.is_active,
      },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/admin-users/:id/status", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  if (params.data.id === req.auth!.userId && parsed.data.status === "disabled") {
    return res.status(409).json({ error: { code: "SELF_MUTATION_BLOCKED", message: "Cannot disable current session user" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, is_active FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const updated = await client.query(
      `UPDATE admin_users
       SET is_active = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.status === "active"]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_status_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: { isActive: before.rows[0].is_active },
      after: { isActive: row.is_active },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

adminUserManagementRouter.patch("/admin-users/:id/role", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const params = UuidParamSchema.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: params.error.flatten() } });
  }

  const parsed = UpdateAdminUserRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  if (params.data.id === req.auth!.userId && parsed.data.role !== "super_admin") {
    return res.status(409).json({ error: { code: "SELF_MUTATION_BLOCKED", message: "Cannot demote current session user" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT id, role FROM admin_users WHERE id = $1 FOR UPDATE",
      [params.data.id]
    );

    if ((before.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ADMIN_USER_NOT_FOUND", message: "Admin user not found" } });
    }

    const updated = await client.query(
      `UPDATE admin_users
       SET role = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, email, role, is_active, last_login_at::text, created_at::text, updated_at::text`,
      [params.data.id, parsed.data.role]
    );

    const row = updated.rows[0];
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_account_role_updated",
      entityType: "admin_users",
      entityId: row.id,
      before: { role: before.rows[0].role },
      after: { role: row.role },
    });

    await client.query("COMMIT");
    return res.json({ data: row });
  } catch (error) {
    await client.query("ROLLBACK");
    return handleMutationError(res, error);
  } finally {
    client.release();
  }
});

function handleMutationError(res: Response, error: unknown) {
  const err = error as { code?: string; constraint?: string };
  if (err.code === "23505" && err.constraint?.includes("users_email")) {
    return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });
  }
  if (err.code === "23505" && err.constraint?.includes("users_display_name")) {
    return res.status(409).json({ error: { code: "DISPLAY_NAME_TAKEN", message: "Display name already used" } });
  }
  if (err.code === "23505" && err.constraint?.includes("users_username")) {
    return res.status(409).json({ error: { code: "USERNAME_TAKEN", message: "Username already used" } });
  }
  if (err.code === "23505" && err.constraint?.includes("admin_users_email")) {
    return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });
  }
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Mutation failed" } });
}
