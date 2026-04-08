import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { recalculateFoodStockTx } from "../services/lots.js";
import { enqueueOutboxEvent } from "../services/outbox.js";
const CreateLotSchema = z.object({
  foodId: z.string().uuid(),
  producedAt: z.string().datetime(),
  saleStartsAt: z.string().datetime(),
  saleEndsAt: z.string().datetime(),
  useBy: z.string().datetime().optional(),
  bestBefore: z.string().datetime().optional(),
  quantityProduced: z.number().int().min(1),
  quantityAvailable: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});

const AdjustLotSchema = z.object({
  quantityAvailable: z.number().int().min(0),
  saleEndsAt: z.string().datetime().optional(),
  notes: z.string().min(2).max(500).optional(),
});

const RecallLotSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const sellerLotsRouter = Router();
export const adminLotsRouter = Router();

sellerLotsRouter.post("/", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const parsed = CreateLotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;
  const qtyAvailable = input.quantityAvailable ?? input.quantityProduced;
  if (qtyAvailable > input.quantityProduced) {
    return res.status(400).json({ error: { code: "LOT_INVALID_QUANTITY", message: "Available cannot exceed produced" } });
  }
  if (new Date(input.producedAt).getTime() > new Date(input.saleStartsAt).getTime()) {
    return res.status(400).json({ error: { code: "LOT_INVALID_TIMELINE", message: "producedAt must be before saleStartsAt" } });
  }
  if (new Date(input.saleStartsAt).getTime() > new Date(input.saleEndsAt).getTime()) {
    return res.status(400).json({ error: { code: "LOT_INVALID_TIMELINE", message: "saleStartsAt must be before saleEndsAt" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const food = await client.query<{ id: string; recipe: string | null; ingredients_json: unknown; allergens_json: unknown }>(
      `SELECT id, recipe, ingredients_json, allergens_json
       FROM foods
       WHERE id = $1 AND seller_id = $2`,
      [input.foodId, req.auth!.userId]
    );
    if ((food.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found in seller scope" } });
    }
    const recipeSnapshot = food.rows[0].recipe ?? null;
    const ingredientsSnapshot = food.rows[0].ingredients_json ?? null;
    const allergensSnapshot = food.rows[0].allergens_json ?? null;
    const missingFields: string[] = [];
    if (!recipeSnapshot || recipeSnapshot.trim().length === 0) {
      missingFields.push("recipe");
    }
    if (ingredientsSnapshot === null) {
      missingFields.push("ingredients_json");
    }
    if (allergensSnapshot === null) {
      missingFields.push("allergens_json");
    }
    if (missingFields.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: {
          code: "LOT_SNAPSHOT_REQUIRED",
          message: "Recipe, ingredients, and allergens must be defined on food before creating a lot",
          details: { missingFields },
        },
      });
    }

    const lotNumber = `CZ-${input.foodId.slice(0, 8).toUpperCase()}-${new Date(input.producedAt).toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    // Snapshot fields are immutable and are persisted only at lot creation time.
    const created = await client.query<{ id: string; lot_number: string }>(
      `INSERT INTO production_lots
        (seller_id, food_id, lot_number, produced_at, sale_starts_at, sale_ends_at, use_by, best_before, recipe_snapshot, ingredients_snapshot_json, allergens_snapshot_json, quantity_produced, quantity_available, status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'open', $14, now(), now())
       RETURNING id, lot_number`,
      [
        req.auth!.userId,
        input.foodId,
        lotNumber,
        input.producedAt,
        input.saleStartsAt,
        input.saleEndsAt,
        input.useBy ?? null,
        input.bestBefore ?? null,
        recipeSnapshot,
        JSON.stringify(ingredientsSnapshot),
        JSON.stringify(allergensSnapshot),
        input.quantityProduced,
        qtyAvailable,
        input.notes ?? null,
      ]
    );
    await client.query(
      `INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
       VALUES ($1, 'created', $2, $3, now())`,
      [
        created.rows[0].id,
        JSON.stringify({
          quantityProduced: input.quantityProduced,
          quantityAvailable: qtyAvailable,
          producedAt: input.producedAt,
          saleStartsAt: input.saleStartsAt,
          saleEndsAt: input.saleEndsAt,
        }),
        req.auth!.userId,
      ]
    );
    await recalculateFoodStockTx(client, input.foodId);
    await enqueueOutboxEvent(client, {
      eventType: "lot_created",
      aggregateType: "production_lot",
      aggregateId: created.rows[0].id,
      payload: { lotId: created.rows[0].id, lotNumber: created.rows[0].lot_number, foodId: input.foodId },
    });
    await client.query("COMMIT");
    return res.status(201).json({ data: { lotId: created.rows[0].id, lotNumber: created.rows[0].lot_number } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Create lot failed" } });
  } finally {
    client.release();
  }
});

sellerLotsRouter.get("/", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const foodId = req.query.foodId ? String(req.query.foodId) : null;
  if (foodId && !z.string().uuid().safeParse(foodId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid foodId" } });
  }
  const lots = await pool.query(
    `SELECT id,
            food_id,
            lot_number,
            produced_at::text,
            sale_starts_at::text,
            sale_ends_at::text,
            use_by::text,
            best_before::text,
            recipe_snapshot,
            ingredients_snapshot_json,
            allergens_snapshot_json,
            quantity_produced,
            quantity_available,
            status,
            CASE
              WHEN status IN ('recalled', 'discarded', 'depleted', 'expired') THEN status
              WHEN sale_ends_at < now() THEN 'expired'
              ELSE 'on_sale'
            END AS lifecycle_status,
            notes,
            created_at::text,
            updated_at::text
     FROM production_lots
     WHERE seller_id = $1
       AND ($2::uuid IS NULL OR food_id = $2::uuid)
     ORDER BY produced_at DESC, created_at DESC`,
    [req.auth!.userId, foodId]
  );
  return res.json({ data: lots.rows });
});

sellerLotsRouter.post("/:lotId/adjust", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const lotId = String(req.params.lotId ?? "");
  if (!z.string().uuid().safeParse(lotId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid lot id" } });
  }
  const parsed = AdjustLotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lot = await client.query<{
      food_id: string;
      seller_id: string;
      status: string;
      quantity_produced: number;
      sale_starts_at: string;
      sale_ends_at: string;
    }>(
      "SELECT food_id, seller_id, status, quantity_produced, sale_starts_at::text, sale_ends_at::text FROM production_lots WHERE id = $1 FOR UPDATE",
      [lotId]
    );
    if ((lot.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "LOT_NOT_FOUND", message: "Lot not found" } });
    }
    const row = lot.rows[0];
    if (row.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_LOT_SCOPE", message: "No access to this lot" } });
    }
    if (["recalled", "discarded"].includes(row.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "LOT_STATUS_INVALID", message: "Cannot adjust recalled/discarded lot" } });
    }
    if (parsed.data.quantityAvailable > Number(row.quantity_produced)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "LOT_INVALID_QUANTITY", message: "Available cannot exceed produced" } });
    }
    if (parsed.data.saleEndsAt && new Date(row.sale_starts_at).getTime() > new Date(parsed.data.saleEndsAt).getTime()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "LOT_INVALID_TIMELINE", message: "saleEndsAt must be after saleStartsAt" } });
    }

    await client.query(
      `UPDATE production_lots
       SET quantity_available = $2,
           sale_ends_at = coalesce($3::timestamptz, sale_ends_at),
           -- Snapshot fields remain immutable after lot creation.
           status = CASE
             WHEN $2 = 0 THEN 'depleted'
             WHEN coalesce($3::timestamptz, sale_ends_at) < now() THEN 'expired'
             WHEN status IN ('depleted', 'expired') AND $2 > 0 THEN 'open'
             ELSE status
           END,
           notes = coalesce($4, notes),
           updated_at = now()
       WHERE id = $1`,
      [lotId, parsed.data.quantityAvailable, parsed.data.saleEndsAt ?? null, parsed.data.notes ?? null]
    );
    await client.query(
      `INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
       VALUES ($1, 'adjusted', $2, $3, now())`,
      [
        lotId,
        JSON.stringify({
          quantityAvailable: parsed.data.quantityAvailable,
          saleEndsAt: parsed.data.saleEndsAt ?? null,
          notes: parsed.data.notes ?? null,
        }),
        req.auth!.userId,
      ]
    );
    await recalculateFoodStockTx(client, row.food_id);
    await client.query("COMMIT");
    return res.json({ data: { lotId, quantityAvailable: parsed.data.quantityAvailable } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Adjust lot failed" } });
  } finally {
    client.release();
  }
});

sellerLotsRouter.post("/:lotId/recall", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const lotId = String(req.params.lotId ?? "");
  if (!z.string().uuid().safeParse(lotId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid lot id" } });
  }
  const parsed = RecallLotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lot = await client.query<{ food_id: string; seller_id: string; status: string }>(
      "SELECT food_id, seller_id, status FROM production_lots WHERE id = $1 FOR UPDATE",
      [lotId]
    );
    if ((lot.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "LOT_NOT_FOUND", message: "Lot not found" } });
    }
    if (lot.rows[0].seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_LOT_SCOPE", message: "No access to this lot" } });
    }

    await client.query(
      `UPDATE production_lots
       SET status = 'recalled', quantity_available = 0, updated_at = now(), notes = coalesce(notes, '') || $2
       WHERE id = $1`,
      [lotId, `\n[recall] ${parsed.data.reason}`]
    );
    await client.query(
      `INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
       VALUES ($1, 'recalled', $2, $3, now())`,
      [lotId, JSON.stringify({ reason: parsed.data.reason }), req.auth!.userId]
    );
    await recalculateFoodStockTx(client, lot.rows[0].food_id);
    await enqueueOutboxEvent(client, {
      eventType: "lot_recalled",
      aggregateType: "production_lot",
      aggregateId: lotId,
      payload: { lotId, reason: parsed.data.reason },
    });
    await client.query("COMMIT");
    return res.json({ data: { lotId, status: "recalled" } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Recall lot failed" } });
  } finally {
    client.release();
  }
});

adminLotsRouter.get("/", requireAuth("admin"), async (req, res) => {
  const sellerId = req.query.sellerId ? String(req.query.sellerId) : null;
  const foodId = req.query.foodId ? String(req.query.foodId) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const list = await pool.query(
    `SELECT id,
            seller_id,
            food_id,
            lot_number,
            produced_at::text,
            sale_starts_at::text,
            sale_ends_at::text,
            use_by::text,
            best_before::text,
            recipe_snapshot,
            ingredients_snapshot_json,
            allergens_snapshot_json,
            quantity_produced,
            quantity_available,
            status,
            CASE
              WHEN status IN ('recalled', 'discarded', 'depleted', 'expired') THEN status
              WHEN sale_ends_at < now() THEN 'expired'
              ELSE 'on_sale'
            END AS lifecycle_status,
            notes,
            created_at::text,
            updated_at::text
     FROM production_lots
     WHERE ($1::uuid IS NULL OR seller_id = $1::uuid)
       AND ($2::uuid IS NULL OR food_id = $2::uuid)
       AND ($3::text IS NULL OR status = $3::text)
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    [sellerId, foodId, status, pageSize, offset]
  );
  const total = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c
     FROM production_lots
     WHERE ($1::uuid IS NULL OR seller_id = $1::uuid)
       AND ($2::uuid IS NULL OR food_id = $2::uuid)
       AND ($3::text IS NULL OR status = $3::text)`,
    [sellerId, foodId, status]
  );

  return res.json({
    data: list.rows,
    pagination: {
      mode: "offset",
      page,
      pageSize,
      total: Number(total.rows[0].c),
      totalPages: Math.ceil(Number(total.rows[0].c) / pageSize),
    },
  });
});

adminLotsRouter.get("/:lotId/orders", requireAuth("admin"), async (req, res) => {
  const lotId = String(req.params.lotId ?? "");
  if (!z.string().uuid().safeParse(lotId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid lot id" } });
  }

  const rows = await pool.query(
    `SELECT o.id AS order_id, o.status, o.created_at::text, o.buyer_id, o.seller_id, a.quantity_allocated
     FROM order_item_lot_allocations a
     JOIN orders o ON o.id = a.order_id
     WHERE a.lot_id = $1
     ORDER BY o.created_at DESC`,
    [lotId]
  );
  return res.json({ data: rows.rows });
});
