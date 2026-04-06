import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { requireIdempotency } from "../middleware/idempotency.js";
import {
  canActorSetStatus,
  canTransition,
  isTerminalStatus,
  type OrderStatus,
} from "../services/order-state-machine.js";
import { finalizeOrderFinanceTx } from "../services/finance.js";
import { enqueueOutboxEvent } from "../services/outbox.js";
import { allocateLotsFefoTx } from "../services/lots.js";
import { emitEtaMilestonesTx, emitOrderMilestoneTx } from "../services/order-notifications.js";
import { flushPushNotifications, type PushNotificationPayload } from "../services/push-notifications.js";
import { estimateRouteDurationSeconds, extractAddressLine, extractLatLng, geocodeAddress, type LatLng } from "../services/routing.js";
import { normalizeDeliveryType } from "../utils/delivery-type.js";

const CreateOrderSchema = z.object({
  sellerId: z.string().uuid(),
  deliveryType: z.enum(["pickup", "delivery"]).optional().default("pickup"),
  deliveryAddress: z.record(z.string(), z.unknown()).optional(),
  requestedAt: z.string().datetime().optional(),
  items: z.array(z.object({
    lotId: z.string().uuid(),
    quantity: z.number().int().positive(),
    selectedAddons: z.object({
      free: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        kind: z.enum(["sauce", "extra", "appetizer"]).optional(),
      })).max(50).optional(),
      paid: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        kind: z.enum(["sauce", "extra", "appetizer"]).optional(),
        price: z.number().min(0.01).max(100000),
        quantity: z.number().int().min(1).max(10).optional(),
      })).max(50).optional(),
    }).optional(),
  })).min(1),
});

const ListOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  role: z.enum(["buyer", "seller"]).optional(),
});

const StatusSchema = z.object({
  toStatus: z.enum([
    "preparing",
    "ready",
    "in_delivery",
    "approaching",
    "at_door",
    "delivered",
    "completed",
    "cancelled",
  ]),
  reason: z.string().min(3).max(500).optional(),
});

const SellerDecisionSchema = z.object({
  decision: z.enum(["approve", "revise", "reject"]),
  deliveryType: z.enum(["pickup", "delivery"]).optional(),
  etaMinutes: z.number().int().min(1).max(1440).optional(),
  note: z.string().max(1000).optional(),
  reason: z.string().min(3).max(500).optional(),
});

const BuyerDeliveryRequestSchema = z.object({
  requestedDeliveryType: z.enum(["delivery"]).optional().default("delivery"),
});

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: OrderStatus;
  total_price: string;
  payment_completed: boolean;
  delivery_type: string;
  requested_delivery_type?: string;
  active_delivery_type?: string;
  seller_decision_state?: string;
  seller_eta_minutes?: number | null;
  seller_promised_at?: string | null;
  seller_delivery_note?: string | null;
  seller_delivery_terms_snapshot?: string | null;
  approved_at?: string | null;
  payment_captured_at?: string | null;
  delivery_address_json: unknown;
  estimated_delivery_time: string | null;
};

type SellerDeliverySettings = {
  delivery_enabled: boolean;
  delivery_terms: string | null;
};

const OrderLocationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().positive().max(10000).optional(),
});

type OrderAddonKind = "sauce" | "extra" | "appetizer";
type NormalizedSelectedAddons = {
  free: Array<{ name: string; kind: OrderAddonKind }>;
  paid: Array<{ name: string; kind: OrderAddonKind; price: number; quantity: number }>;
};

function randomDeliveryPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSelectedAddons(input: unknown): NormalizedSelectedAddons {
  if (!input || typeof input !== "object") return { free: [], paid: [] };
  const row = input as Record<string, unknown>;
  const freeRaw = Array.isArray(row.free) ? row.free : [];
  const paidRaw = Array.isArray(row.paid) ? row.paid : [];

  const freeSeen = new Set<string>();
  const paidSeen = new Set<string>();
  const free: Array<{ name: string; kind: OrderAddonKind }> = [];
  const paid: Array<{ name: string; kind: OrderAddonKind; price: number; quantity: number }> = [];

  for (const raw of freeRaw) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = String(entry.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const rawKind = String(entry.kind ?? "").trim().toLocaleLowerCase("en-US");
    const kind: OrderAddonKind = rawKind === "sauce" || rawKind === "appetizer" ? rawKind : "extra";
    const key = `${name.toLocaleLowerCase("tr-TR")}|${kind}`;
    if (freeSeen.has(key)) continue;
    freeSeen.add(key);
    free.push({ name, kind });
  }

  for (const raw of paidRaw) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = String(entry.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const parsedPrice = Number(entry.price);
    const price = Number.isFinite(parsedPrice) ? Number(parsedPrice.toFixed(2)) : Number.NaN;
    if (!Number.isFinite(price) || price <= 0) continue;
    const parsedQuantity = Number(entry.quantity);
    const quantity = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10
      ? parsedQuantity
      : 1;
    const rawKind = String(entry.kind ?? "").trim().toLocaleLowerCase("en-US");
    const kind: OrderAddonKind = rawKind === "sauce" || rawKind === "appetizer" ? rawKind : "extra";
    const key = `${name.toLocaleLowerCase("tr-TR")}|${kind}|${price}|${quantity}`;
    if (paidSeen.has(key)) continue;
    paidSeen.add(key);
    paid.push({ name, kind, price, quantity });
  }

  return {
    free: free.slice(0, 50),
    paid: paid.slice(0, 50),
  };
}

function selectedPaidAddonsTotal(selectedAddons: NormalizedSelectedAddons): number {
  const total = selectedAddons.paid.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  return Number(total.toFixed(2));
}

function resolveDeliveryDestination(deliveryAddressJson: unknown): { coord: LatLng | null; addressLine: string | null } {
  const coord = extractLatLng(deliveryAddressJson);
  const addressLine = extractAddressLine(deliveryAddressJson);
  return { coord, addressLine };
}

function normalizeDecisionDeliveryType(value: unknown): "pickup" | "delivery" {
  return normalizeDeliveryType(value) === "delivery" ? "delivery" : "pickup";
}

function computePromisedAtIso(etaMinutes: number): string {
  return new Date(Date.now() + etaMinutes * 60_000).toISOString();
}

async function loadSellerDeliverySettingsTx(client: PoolClient, sellerId: string): Promise<SellerDeliverySettings> {
  const result = await client.query<SellerDeliverySettings>(
    `SELECT delivery_enabled, delivery_terms
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [sellerId],
  );
  return {
    delivery_enabled: Boolean(result.rows[0]?.delivery_enabled),
    delivery_terms: result.rows[0]?.delivery_terms ?? null,
  };
}

async function autoCapturePaymentForOrderTx(
  client: PoolClient,
  input: { orderId: string; buyerId: string; fromStatus: string; actorUserId: string | null },
): Promise<{ provider: string; providerReferenceId: string }> {
  const sessionId = crypto.randomUUID();
  const providerReferenceId = `${String(env.PAYMENT_PROVIDER_NAME || "auto").toUpperCase()}-${Date.now()}`;

  await client.query(
    `INSERT INTO payment_attempts
      (order_id, buyer_id, provider, provider_session_id, provider_reference_id, status, signature_valid, callback_payload_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', TRUE, $6::jsonb, now(), now())`,
    [
      input.orderId,
      input.buyerId,
      env.PAYMENT_PROVIDER_NAME,
      sessionId,
      providerReferenceId,
      JSON.stringify({ autoCaptured: true, approvedBy: input.actorUserId, capturedAt: new Date().toISOString() }),
    ],
  );

  await client.query(
    `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
     VALUES ($1, $2, 'payment_captured', $3, 'paid', $4)`,
    [
      input.orderId,
      input.actorUserId,
      input.fromStatus,
      JSON.stringify({ provider: env.PAYMENT_PROVIDER_NAME, providerReferenceId, autoCaptured: true }),
    ],
  );

  await enqueueOutboxEvent(client, {
    eventType: "payment_confirmed",
    aggregateType: "order",
    aggregateId: input.orderId,
    payload: { orderId: input.orderId, providerReferenceId, autoCaptured: true },
  });

  return { provider: env.PAYMENT_PROVIDER_NAME, providerReferenceId };
}

function trackingStatusLabel(status: string): string {
  if (status === "in_delivery") return "Yolda";
  if (status === "approaching") return "Yaklaştı";
  if (status === "at_door") return "Kapıda";
  if (status === "ready") return "Hazır";
  if (status === "preparing") return "Hazırlanıyor";
  if (status === "delivered") return "Teslim edildi";
  if (status === "completed") return "Tamamlandı";
  if (status === "cancelled") return "İptal edildi";
  return "Sipariş alındı";
}

const PICKUP_STATUS_ORDER: OrderStatus[] = [
  "paid",
  "preparing",
  "ready",
  "in_delivery",
  "approaching",
  "at_door",
  "delivered",
  "completed",
];

function isPickupParallelNoopAllowed(currentStatus: OrderStatus, requestedStatus: OrderStatus): boolean {
  const currentIndex = PICKUP_STATUS_ORDER.indexOf(currentStatus);
  const requestedIndex = PICKUP_STATUS_ORDER.indexOf(requestedStatus);
  if (currentIndex < 0 || requestedIndex < 0) return false;
  return requestedIndex <= currentIndex;
}

function isPickupBuyerParallelTransitionAllowed(currentStatus: OrderStatus, requestedStatus: OrderStatus): boolean {
  if (requestedStatus === "in_delivery") {
    return ["paid", "preparing", "ready", "in_delivery"].includes(currentStatus);
  }
  if (requestedStatus === "approaching") {
    return ["in_delivery", "approaching"].includes(currentStatus);
  }
  if (requestedStatus === "at_door") {
    return ["approaching", "at_door"].includes(currentStatus);
  }
  return false;
}

async function tableExistsTx(client: PoolClient, fqTableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [fqTableName],
  );
  return result.rows[0]?.exists === true;
}

async function ensureAllergenDisclosuresForCompletionTx(
  client: PoolClient,
  order: { id: string; seller_id: string; buyer_id: string },
): Promise<("pre_order" | "handover")[]> {
  const disclosure = await client.query<{ pre_order_count: string; handover_count: string }>(
    `SELECT
      count(*) FILTER (WHERE phase = 'pre_order')::text AS pre_order_count,
      count(*) FILTER (WHERE phase = 'handover')::text AS handover_count
     FROM allergen_disclosure_records
     WHERE order_id = $1`,
    [order.id],
  );
  const preOrder = Number(disclosure.rows[0]?.pre_order_count ?? "0");
  const handover = Number(disclosure.rows[0]?.handover_count ?? "0");
  const missingPhases: ("pre_order" | "handover")[] = [];
  if (preOrder < 1) missingPhases.push("pre_order");
  if (handover < 1) missingPhases.push("handover");
  if (missingPhases.length === 0) return [];

  const foodRef = await client.query<{ food_id: string }>(
    "SELECT food_id::text FROM order_items WHERE order_id = $1 ORDER BY created_at ASC LIMIT 1",
    [order.id],
  );
  if ((foodRef.rowCount ?? 0) === 0) throw new Error("ORDER_INVALID_ITEMS");
  const foodId = String(foodRef.rows[0].food_id);
  const occurredAt = new Date().toISOString();

  for (const phase of missingPhases) {
    await client.query(
      `INSERT INTO allergen_disclosure_records
        (order_id, phase, seller_id, buyer_id, food_id, allergen_snapshot_json, disclosure_method, buyer_confirmation, evidence_ref, occurred_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, now())
       ON CONFLICT (order_id, phase) DO NOTHING`,
      [
        order.id,
        phase,
        order.seller_id,
        order.buyer_id,
        foodId,
        "{}",
        phase === "pre_order" ? "ui_ack" : "verbal",
        "acknowledged",
        "auto_backfill_on_complete_transition",
        occurredAt,
      ],
    );
  }

  return missingPhases;
}

export const ordersRouter = Router();

ordersRouter.post(
  "/",
  requireAuth("app"),
  abuseProtection({ flow: "order_create", ipLimit: 30, userLimit: 20, windowMs: 60_000 }),
  requireIdempotency({ scope: "order_create" }),
  async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "buyer") {
    return res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Order create requires buyer role. Use x-actor-role header for both-role users.",
      },
    });
  }

  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const client = await pool.connect();
  const pushQueue: PushNotificationPayload[] = [];
  let committed = false;
  try {
    await client.query("BEGIN");

    const uniqueLotIds = new Set(input.items.map((item) => item.lotId));
    if (uniqueLotIds.size !== input.items.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "ORDER_DUPLICATE_LOTS", message: "Each lot can be used only once per order" } });
    }

    const sellerSettings = await loadSellerDeliverySettingsTx(client, input.sellerId);

    const lots = await client.query<{
      lot_id: string;
      food_id: string;
      seller_id: string;
      quantity_available: number;
      status: string;
      sale_starts_at: string;
      sale_ends_at: string;
      price: string;
      food_is_active: boolean;
    }>(
      `SELECT l.id AS lot_id,
              l.food_id,
              l.seller_id,
              l.quantity_available,
              l.status,
              l.sale_starts_at::text,
              l.sale_ends_at::text,
              f.price::text AS price,
              f.is_active AS food_is_active
       FROM production_lots l
       LEFT JOIN foods f ON f.id = l.food_id
       WHERE l.id = ANY($1::uuid[])`,
      [input.items.map((item) => item.lotId)]
    );

    if (lots.rowCount !== input.items.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "LOT_NOT_FOUND", message: "One or more lots do not exist" } });
    }

    const lotsMap = new Map(lots.rows.map((lot) => [lot.lot_id, lot]));
    const now = Date.now();
    for (const item of input.items) {
      const lot = lotsMap.get(item.lotId);
      if (!lot || lot.seller_id !== input.sellerId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: { code: "ORDER_INVALID_ITEMS", message: "Lots must belong to selected seller" },
        });
      }
      if (!["open", "active"].includes(lot.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: { code: "LOT_NOT_ACTIVE", message: "Lot is not active for ordering" } });
      }
      if (Date.parse(lot.sale_starts_at) > now || Date.parse(lot.sale_ends_at) < now) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: { code: "LOT_NOT_ON_SALE", message: "Lot is outside sale window" } });
      }
      if (!lot.food_is_active) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: { code: "FOOD_NOT_ACTIVE", message: "Lot food is not active" } });
      }
      if (Number(lot.quantity_available) < item.quantity) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: { code: "LOT_STOCK_INSUFFICIENT", message: "Not enough stock in selected lot" } });
      }
      if (!lot.price) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: { code: "LOT_PRICE_UNAVAILABLE", message: "Lot food price is unavailable" } });
      }
    }

    if (input.deliveryType === "delivery" && !sellerSettings.delivery_enabled) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "DELIVERY_NOT_ENABLED", message: "Satıcı bu sipariş için teslimat sunmuyor." },
      });
    }

    const normalizedAddonsByLotId = new Map<string, NormalizedSelectedAddons>();
    let subtotal = 0;
    for (const item of input.items) {
      const price = Number(lotsMap.get(item.lotId)!.price);
      const selectedAddons = normalizeSelectedAddons(item.selectedAddons);
      normalizedAddonsByLotId.set(item.lotId, selectedAddons);
      subtotal += (price * item.quantity) + selectedPaidAddonsTotal(selectedAddons);
    }
    subtotal = Number(subtotal.toFixed(2));
    const deliveryFee = 0;
    const total = Number((subtotal + deliveryFee).toFixed(2));

    const orderInsert = await client.query<{ id: string }>(
      `INSERT INTO orders (
         buyer_id,
         seller_id,
         status,
         delivery_type,
         requested_delivery_type,
         active_delivery_type,
         seller_decision_state,
         seller_delivery_terms_snapshot,
         delivery_address_json,
         total_price,
         requested_at
       )
       VALUES ($1, $2, 'pending_seller_approval', $3, $4, $5, 'pending', $6, $7, $8, $9)
       RETURNING id`,
      [
        req.auth!.userId,
        input.sellerId,
        input.deliveryType,
        input.deliveryType,
        input.deliveryType,
        input.deliveryType === "delivery" ? sellerSettings.delivery_terms : null,
        input.deliveryAddress ? JSON.stringify(input.deliveryAddress) : null,
        total,
        input.requestedAt ?? null,
      ]
    );

    for (const item of input.items) {
      const lot = lotsMap.get(item.lotId)!;
      const price = Number(lot.price);
      const selectedAddons = normalizedAddonsByLotId.get(item.lotId) ?? { free: [], paid: [] };
      const lineTotal = Number(((price * item.quantity) + selectedPaidAddonsTotal(selectedAddons)).toFixed(2));
      await client.query(
        `INSERT INTO order_items (order_id, lot_id, food_id, quantity, unit_price, line_total, selected_addons_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          orderInsert.rows[0].id,
          item.lotId,
          lot.food_id,
          item.quantity,
          price,
          lineTotal,
          JSON.stringify(selectedAddons),
        ]
      );
      await client.query(
        `UPDATE production_lots SET quantity_available = quantity_available - $1 WHERE id = $2`,
        [item.quantity, item.lotId]
      );
    }

    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderInsert.rows[0].id,
        req.auth!.userId,
        "order_created",
        null,
        "pending_seller_approval",
        JSON.stringify({ deliveryType: input.deliveryType, subtotal, deliveryFee }),
      ]
    );

    await enqueueOutboxEvent(client, {
      eventType: "order_created",
      aggregateType: "order",
      aggregateId: orderInsert.rows[0].id,
      payload: {
        orderId: orderInsert.rows[0].id,
        buyerId: req.auth!.userId,
        sellerId: input.sellerId,
        subtotal,
        deliveryFee,
        totalPrice: total,
      },
    });

    await client.query("COMMIT");
    committed = true;

    // Notifications are best-effort and must run outside the transaction to avoid
    // aborting the transaction when notification infra tables are missing.
    const pushQueue: PushNotificationPayload[] = [];
    await emitOrderMilestoneTx(
      pool,
      {
        orderId: orderInsert.rows[0].id,
        buyerId: req.auth!.userId,
        milestone: "order_received",
      },
      pushQueue,
    ).catch((err) => console.error("[orders] post-commit milestone failed (non-fatal)", err));
    if (pushQueue.length > 0) {
      flushPushNotifications(pushQueue).catch((pushErr) =>
        console.error("[orders] push flush failed after create commit", pushErr),
      );
    }

    return res.status(201).json({
      data: {
        orderId: orderInsert.rows[0].id,
        status: "pending_seller_approval",
        deliveryType: input.deliveryType,
        subtotal,
        deliveryFee,
        totalPrice: total,
      },
    });
  } catch {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Order create failed" } });
  } finally {
    client.release();
  }
  }
);

ordersRouter.get("/", requireAuth("app"), async (req, res) => {
  const parsed = ListOrdersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const { page, pageSize, sortDir, role } = parsed.data;
  const offset = (page - 1) * pageSize;

  const countWhere =
    role === "seller" ? "seller_id = $1 AND status NOT IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment', 'rejected', 'cancelled')" :
    role === "buyer"  ? "buyer_id = $1"  :
    "(buyer_id = $1 OR seller_id = $1)";
  const listWhere =
    role === "seller" ? "o.seller_id = $1 AND o.status NOT IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment', 'rejected', 'cancelled')" :
    role === "buyer"  ? "o.buyer_id = $1"  :
    "(o.buyer_id = $1 OR o.seller_id = $1)";

  const totalResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM orders WHERE ${countWhere}`,
    [req.auth!.userId]
  );

  const listResult = await pool.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    delivery_type: string;
    requested_delivery_type: string;
    active_delivery_type: string;
    seller_decision_state: string;
    delivery_address_json: unknown;
    total_price: string;
    created_at: string;
    updated_at: string;
    seller_name: string;
    seller_image: string | null;
    buyer_name: string;
  }>(
    `SELECT o.id, o.buyer_id, o.seller_id, o.status, o.delivery_type, o.requested_delivery_type, o.active_delivery_type, o.seller_decision_state,
            o.delivery_address_json, o.total_price::text, o.created_at::text, o.updated_at::text,
            s.display_name AS seller_name, s.profile_image_url AS seller_image,
            b.display_name AS buyer_name
     FROM orders o
     JOIN users s ON s.id = o.seller_id
     JOIN users b ON b.id = o.buyer_id
     WHERE ${listWhere}
     ORDER BY o.created_at ${sortDir === "asc" ? "ASC" : "DESC"}, o.id ${sortDir === "asc" ? "ASC" : "DESC"}
     LIMIT $2 OFFSET $3`,
    [req.auth!.userId, pageSize, offset]
  );

  // Fetch order items for all orders in one query
  const orderIds = listResult.rows.map((r) => r.id);
  let itemsByOrder: Record<string, {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    selectedAddons: NormalizedSelectedAddons;
  }[]> = {};
  if (orderIds.length > 0) {
    const itemsResult = await pool.query<{
      order_id: string;
      food_name: string;
      quantity: number;
      unit_price: string;
      line_total: string;
      selected_addons_json: unknown;
    }>(
      `SELECT oi.order_id, f.name AS food_name, oi.quantity, oi.unit_price::text, oi.line_total::text, oi.selected_addons_json
       FROM order_items oi
       JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = ANY($1)
       ORDER BY oi.created_at ASC`,
      [orderIds]
    );
    for (const item of itemsResult.rows) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        name: item.food_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
        selectedAddons: normalizeSelectedAddons(item.selected_addons_json),
      });
    }
  }

  const total = Number(totalResult.rows[0].count);
  return res.json({
    data: listResult.rows.map((row) => ({
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      status: row.status,
      deliveryType: normalizeDeliveryType(row.delivery_type) ?? row.delivery_type,
      requestedDeliveryType: normalizeDeliveryType(row.requested_delivery_type) ?? row.requested_delivery_type,
      activeDeliveryType: normalizeDeliveryType(row.active_delivery_type) ?? row.active_delivery_type,
      sellerDecisionState: row.seller_decision_state,
      deliveryAddress: row.delivery_address_json,
      totalPrice: Number(row.total_price),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sellerName: row.seller_name,
      sellerImage: row.seller_image,
      buyerName: row.buyer_name,
      items: itemsByOrder[row.id] ?? [],
    })),
    pagination: {
      mode: "offset",
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

/* ────── GET /orders/:id — order detail with items + events ────── */
ordersRouter.get("/:id", requireAuth("app"), async (req, res) => {
  const orderId = req.params.id;
  const userId = req.auth!.userId;

  const orderResult = await pool.query<{
    id: string; buyer_id: string; seller_id: string; status: string;
    delivery_type: string; requested_delivery_type: string; active_delivery_type: string; seller_decision_state: string;
    seller_eta_minutes: number | null; seller_promised_at: string | null; seller_delivery_note: string | null;
    seller_delivery_terms_snapshot: string | null; approved_at: string | null; payment_captured_at: string | null;
    delivery_address_json: unknown;
    total_price: string; payment_completed: boolean;
    requested_at: string | null; estimated_delivery_time: string | null;
    created_at: string; updated_at: string;
    seller_name: string; seller_image: string | null;
    buyer_name: string;
    seller_address_json: unknown;
  }>(
    `SELECT o.*, s.display_name AS seller_name, s.profile_image_url AS seller_image,
            b.display_name AS buyer_name,
            (SELECT json_build_object('title', sa.title, 'addressLine', sa.address_line)
             FROM user_addresses sa WHERE sa.user_id = o.seller_id AND sa.is_default = TRUE
             LIMIT 1) AS seller_address_json
     FROM orders o
     JOIN users s ON s.id = o.seller_id
     JOIN users b ON b.id = o.buyer_id
     WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)`,
    [orderId, userId]
  );

  if (orderResult.rows.length === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  const o = orderResult.rows[0];

  const [itemsRes, eventsRes] = await Promise.all([
    pool.query<{
      food_name: string; food_image: string | null; quantity: number;
      unit_price: string; line_total: string;
      selected_addons_json: unknown;
    }>(
      `SELECT f.name AS food_name, f.image_url AS food_image, oi.quantity,
              oi.unit_price::text, oi.line_total::text, oi.selected_addons_json
       FROM order_items oi JOIN foods f ON f.id = oi.food_id
       WHERE oi.order_id = $1 ORDER BY oi.created_at ASC`,
      [orderId]
    ),
    pool.query<{
      event_type: string; from_status: string | null; to_status: string | null;
      created_at: string; payload_json: { reason?: string } | null;
    }>(
      `SELECT event_type, from_status, to_status, created_at::text, payload_json
       FROM order_events WHERE order_id = $1 ORDER BY created_at ASC`,
      [orderId]
    ),
  ]);

  return res.json({
    data: {
      id: o.id,
      buyerId: o.buyer_id,
      sellerId: o.seller_id,
      status: o.status,
      deliveryType: normalizeDeliveryType(o.delivery_type) ?? o.delivery_type,
      requestedDeliveryType: normalizeDeliveryType(o.requested_delivery_type) ?? o.requested_delivery_type,
      activeDeliveryType: normalizeDeliveryType(o.active_delivery_type) ?? o.active_delivery_type,
      sellerDecisionState: o.seller_decision_state,
      sellerEtaMinutes: o.seller_eta_minutes ?? null,
      sellerPromisedAt: o.seller_promised_at,
      sellerDeliveryNote: o.seller_delivery_note,
      sellerDeliveryTermsSnapshot: o.seller_delivery_terms_snapshot,
      approvedAt: o.approved_at,
      paymentCapturedAt: o.payment_captured_at,
      deliveryAddress: o.delivery_address_json,
      sellerAddress: o.seller_address_json,
      totalPrice: Number(o.total_price),
      paymentCompleted: o.payment_completed,
      requestedAt: o.requested_at,
      estimatedDeliveryTime: o.estimated_delivery_time,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      sellerName: o.seller_name,
      sellerImage: o.seller_image,
      buyerName: o.buyer_name,
      items: itemsRes.rows.map((i) => ({
        name: i.food_name,
        image: i.food_image,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
        selectedAddons: normalizeSelectedAddons(i.selected_addons_json),
      })),
      events: eventsRes.rows.map((e) => ({
        eventType: e.event_type,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        createdAt: e.created_at,
        reason: e.payload_json?.reason ?? null,
      })),
    },
  });
});

ordersRouter.post("/:id/seller-decision", requireAuth("app"), async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  const parsed = SellerDecisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { decision, reason } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<OrderRow>(
      `SELECT id, buyer_id, seller_id, status, total_price::text, payment_completed, delivery_type,
              requested_delivery_type, active_delivery_type, seller_decision_state, seller_eta_minutes,
              seller_promised_at::text, seller_delivery_note, seller_delivery_terms_snapshot,
              approved_at::text, payment_captured_at::text, delivery_address_json, estimated_delivery_time::text
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const order = orderResult.rows[0];
    if (order.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
    }
    if (isTerminalStatus(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_TERMINAL", message: "Order is already terminal" } });
    }
    if (order.payment_completed && decision !== "reject") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_ALREADY_APPROVED", message: "Sipariş zaten onaylandı." } });
    }
    if (order.status !== "pending_seller_approval") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: `Bu sipariste seller decision kullanilamaz: ${order.status}` },
      });
    }

    if (decision === "reject") {
      if (!reason?.trim()) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: { code: "REJECTION_REASON_REQUIRED", message: "İptal sebebi zorunlu." } });
      }
      await client.query(
        `UPDATE orders
         SET status = 'rejected',
             seller_decision_state = 'rejected',
             updated_at = now()
         WHERE id = $1`,
        [order.id],
      );
      await client.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
         VALUES ($1, $2, 'seller_rejected', $3, 'rejected', $4)`,
        [order.id, req.auth!.userId, order.status, JSON.stringify({ reason: reason.trim() })],
      );
      await client.query("COMMIT");
      return res.json({ data: { orderId: order.id, decision: "reject", status: "rejected" } });
    }

    const deliveryType = normalizeDecisionDeliveryType(parsed.data.deliveryType ?? order.active_delivery_type ?? order.requested_delivery_type ?? order.delivery_type);
    const etaMinutes = Number(parsed.data.etaMinutes ?? 0);
    if (!Number.isInteger(etaMinutes) || etaMinutes <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "ETA_REQUIRED", message: "Dakika bilgisi zorunlu." } });
    }

    const sellerSettings = await loadSellerDeliverySettingsTx(client, order.seller_id);
    if (deliveryType === "delivery" && !sellerSettings.delivery_enabled) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "DELIVERY_NOT_ENABLED", message: "Teslimat ayarı kapalı." } });
    }
    const note = parsed.data.note?.trim() ?? "";
    if (deliveryType === "delivery" && !note) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "DELIVERY_NOTE_REQUIRED", message: "Teslimat notu zorunlu." } });
    }

    const promisedAt = computePromisedAtIso(etaMinutes);
    const termsSnapshot = deliveryType === "delivery" ? sellerSettings.delivery_terms : null;

    if (decision === "revise") {
      await client.query(
        `UPDATE orders
         SET delivery_type = $2,
             active_delivery_type = $2,
             seller_decision_state = 'revised',
             seller_eta_minutes = $3,
             seller_promised_at = $4,
             seller_delivery_note = $5,
             seller_delivery_terms_snapshot = $6,
             updated_at = now()
         WHERE id = $1`,
        [order.id, deliveryType, etaMinutes, promisedAt, note || null, termsSnapshot],
      );
      await client.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
         VALUES ($1, $2, 'seller_plan_revised', $3, $4, $5)`,
        [
          order.id,
          req.auth!.userId,
          order.status,
          order.status,
          JSON.stringify({ deliveryType, etaMinutes, note: note || null, deliveryTermsSnapshot: termsSnapshot }),
        ],
      );
      await client.query("COMMIT");
      return res.json({
        data: { orderId: order.id, decision: "revise", status: order.status, activeDeliveryType: deliveryType, sellerPromisedAt: promisedAt },
      });
    }

    await client.query(
      `UPDATE orders
       SET status = 'paid',
           payment_completed = TRUE,
           payment_captured_at = now(),
           approved_at = now(),
           delivery_type = $2,
           active_delivery_type = $2,
           seller_decision_state = 'approved',
           seller_eta_minutes = $3,
           seller_promised_at = $4,
           seller_delivery_note = $5,
           seller_delivery_terms_snapshot = $6,
           updated_at = now()
       WHERE id = $1`,
      [order.id, deliveryType, etaMinutes, promisedAt, note || null, termsSnapshot],
    );
    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, 'seller_approved', $3, 'seller_approved', $4)`,
      [
        order.id,
        req.auth!.userId,
        order.status,
        JSON.stringify({ deliveryType, etaMinutes, note: note || null, deliveryTermsSnapshot: termsSnapshot }),
      ],
    );
    const paymentResult = await autoCapturePaymentForOrderTx(client, {
      orderId: order.id,
      buyerId: order.buyer_id,
      fromStatus: "seller_approved",
      actorUserId: req.auth!.userId,
    });
    await client.query("COMMIT");
    return res.json({
      data: {
        orderId: order.id,
        decision: "approve",
        status: "paid",
        paymentCompleted: true,
        paymentProvider: paymentResult.provider,
        activeDeliveryType: deliveryType,
        sellerPromisedAt: promisedAt,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[orders] seller decision failed", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Seller decision failed" } });
  } finally {
    client.release();
  }
});

ordersRouter.post("/:id/buyer-delivery-request", requireAuth("app"), async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "buyer") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Buyer role required" } });
  }

  const parsed = BuyerDeliveryRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<OrderRow>(
      `SELECT id, buyer_id, seller_id, status, total_price::text, payment_completed, delivery_type,
              requested_delivery_type, active_delivery_type, seller_decision_state, seller_eta_minutes,
              seller_promised_at::text, seller_delivery_note, seller_delivery_terms_snapshot,
              approved_at::text, payment_captured_at::text, delivery_address_json, estimated_delivery_time::text
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }

    const order = orderResult.rows[0];
    if (order.buyer_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not buyer of this order" } });
    }
    if (isTerminalStatus(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_TERMINAL", message: "Order is already terminal" } });
    }
    if (order.status !== "pending_seller_approval") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: "Teslimat isteği sadece satıcı kararı beklenirken gönderilebilir." },
      });
    }

    const requestedDeliveryType = normalizeDeliveryType(parsed.data.requestedDeliveryType) ?? "delivery";
    if (requestedDeliveryType !== "delivery") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "INVALID_DELIVERY_REQUEST", message: "Geçersiz teslimat isteği." } });
    }

    const alreadyRequested = normalizeDeliveryType(order.requested_delivery_type) === "delivery";
    if (!alreadyRequested) {
      await client.query(
        `UPDATE orders
         SET requested_delivery_type = 'delivery',
             updated_at = now()
         WHERE id = $1`,
        [order.id],
      );
      await client.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
         VALUES ($1, $2, 'buyer_delivery_requested', $3, $4, $5)`,
        [
          order.id,
          req.auth!.userId,
          order.status,
          order.status,
          JSON.stringify({
            requestedDeliveryType: "delivery",
            source: "buyer_cart",
          }),
        ],
      );
    }

    await client.query("COMMIT");
    return res.json({
      data: {
        orderId: order.id,
        requestedDeliveryType: "delivery",
        status: order.status,
        alreadyRequested,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[orders] buyer delivery request failed", error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Buyer delivery request failed" } });
  } finally {
    client.release();
  }
});

/**
 * POST /orders/:id/location
 * Seller location ping during delivery.
 */
ordersRouter.post("/:id/location", requireAuth("app"), async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }

  const parsed = OrderLocationPingSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  const pushQueue: PushNotificationPayload[] = [];
  let committed = false;
  try {
    await client.query("BEGIN");
    const order = await client.query<{
      id: string;
      buyer_id: string;
      seller_id: string;
      status: string;
      delivery_type: string;
      delivery_address_json: unknown;
      estimated_delivery_time: string | null;
    }>(
      `SELECT id, buyer_id, seller_id, status, delivery_type, delivery_address_json, estimated_delivery_time::text
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (order.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }

    const row = order.rows[0];
    if (row.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
    }
    if (row.delivery_type !== "delivery") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "NOT_DELIVERY_ORDER", message: "Tracking only for delivery orders" } });
    }
    if (row.status !== "in_delivery") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_NOT_IN_DELIVERY", message: "Location updates require in_delivery state" } });
    }

    await client.query(
      `INSERT INTO order_delivery_tracking (order_id, seller_user_id, latitude, longitude, accuracy_m, captured_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [row.id, row.seller_id, parsed.data.lat, parsed.data.lng, parsed.data.accuracyM ?? null],
    );

    let destination = extractLatLng(row.delivery_address_json);
    if (!destination) {
      const line = extractAddressLine(row.delivery_address_json);
      if (line) destination = await geocodeAddress(line);
    }

    let remainingSec: number | null = null;
    let routeDurationSec: number | null = null;
    if (destination) {
      routeDurationSec = await estimateRouteDurationSeconds(
        { lat: parsed.data.lat, lng: parsed.data.lng },
        destination,
      );
      if (routeDurationSec !== null) {
        remainingSec = Math.max(0, routeDurationSec);
        const eta = new Date(Date.now() + routeDurationSec * 1000);
        await client.query(
          "UPDATE orders SET estimated_delivery_time = $1, updated_at = now() WHERE id = $2",
          [eta, row.id],
        );
      }
    }

    if (remainingSec !== null) {
      await emitEtaMilestonesTx(
        client,
        {
          orderId: row.id,
          buyerId: row.buyer_id,
          remainingSeconds: remainingSec,
          routeDurationSec,
        },
        pushQueue,
      );
    }

    await client.query("COMMIT");
    committed = true;
    if (pushQueue.length > 0) {
      try {
        await flushPushNotifications(pushQueue);
      } catch (pushErr) {
        console.error("[orders] push flush failed after location commit", pushErr);
      }
    }

    return res.json({
      data: {
        orderId: row.id,
        remainingMinutes: remainingSec === null ? null : Math.max(0, Math.ceil(remainingSec / 60)),
        estimatedDeliveryTime:
          remainingSec === null ? row.estimated_delivery_time : new Date(Date.now() + (remainingSec * 1000)).toISOString(),
      },
    });
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[orders] location ping error:", message);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Location update failed" } });
  } finally {
    client.release();
  }
});

/**
 * GET /orders/:id/tracking
 * Buyer or seller tracking snapshot for delivery orders.
 */
ordersRouter.get("/:id/tracking", requireAuth("app"), async (req, res) => {
  const order = await pool.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    delivery_type: string;
    estimated_delivery_time: string | null;
  }>(
    `SELECT id, buyer_id, seller_id, status, delivery_type, estimated_delivery_time::text
     FROM orders
     WHERE id = $1
     LIMIT 1`,
    [req.params.id],
  );

  if (order.rowCount === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  const row = order.rows[0];
  if (row.buyer_id !== req.auth!.userId && row.seller_id !== req.auth!.userId) {
    return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
  }

  const latestLoc = await pool.query<{ captured_at: string }>(
    `SELECT captured_at::text
     FROM order_delivery_tracking
     WHERE order_id = $1
     ORDER BY captured_at DESC
     LIMIT 1`,
    [row.id],
  );

  const eta = row.estimated_delivery_time ? new Date(row.estimated_delivery_time) : null;
  const remainingMinutes = eta ? Math.max(0, Math.ceil((eta.getTime() - Date.now()) / 60000)) : null;

  return res.json({
    data: {
      orderId: row.id,
      status: row.status,
      statusLabel: trackingStatusLabel(row.status),
      isDelivery: row.delivery_type === "delivery",
      estimatedDeliveryTime: eta ? eta.toISOString() : null,
      remainingMinutes,
      lastSellerLocationAt: latestLoc.rows[0]?.captured_at ?? null,
    },
  });
});

ordersRouter.post("/:id/review", requireAuth("app"), async (req, res) => {
  try {
    const orderId = req.params.id;
    const buyerId = req.auth!.userId;
    const parsedRating = Number(req.body?.rating);
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";

    if (!Number.isFinite(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: { code: "INVALID_RATING", message: "Rating must be between 1 and 5" } });
    }

    const orderRes = await pool.query<{ seller_id: string; status: string; buyer_id: string }>(
      `SELECT seller_id, status, buyer_id FROM orders WHERE id = $1`,
      [orderId]
    );
    if (!orderRes.rows[0]) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found" } });
    const order = orderRes.rows[0];

    if (order.buyer_id !== buyerId) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your order" } });
    if (!["completed", "delivered"].includes(order.status)) {
      return res.status(400).json({ error: { code: "NOT_COMPLETED", message: "Order must be completed to review" } });
    }

    const existing = await pool.query(`SELECT id FROM reviews WHERE order_id = $1`, [orderId]);
    if (existing.rows.length > 0) return res.status(400).json({ error: { code: "ALREADY_REVIEWED", message: "Order already reviewed" } });

    const itemRes = await pool.query<{ food_id: string | null }>(
      `SELECT food_id FROM order_items WHERE order_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [orderId]
    );
    const foodId = itemRes.rows[0]?.food_id;
    if (!foodId) return res.status(400).json({ error: { code: "NO_ITEMS", message: "No items in order" } });

    await pool.query(
      `INSERT INTO reviews (food_id, buyer_id, seller_id, order_id, rating, comment, is_verified_purchase)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [foodId, buyerId, order.seller_id, orderId, parsedRating, comment || null]
    );

    await pool.query(
      `UPDATE foods SET
         rating = (SELECT AVG(rating) FROM reviews WHERE food_id = $1),
         review_count = (SELECT COUNT(*) FROM reviews WHERE food_id = $1)
       WHERE id = $1`,
      [foodId]
    );

    return res.json({ data: { success: true } });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: { code: "ALREADY_REVIEWED", message: "Order already reviewed" } });
    }
    console.error("[orders] review error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to submit review" } });
  }
});

ordersRouter.post("/:id/approve", requireAuth("app"), async (_req, res) => {
  return res.status(410).json({
    error: {
      code: "ORDER_APPROVAL_REMOVED",
      message: "Seller approval is no longer used. Paid orders move directly into seller workflow.",
    },
  });
});

ordersRouter.post("/:id/reject", requireAuth("app"), async (_req, res) => {
  return res.status(410).json({
    error: {
      code: "ORDER_REJECT_REMOVED",
      message: "Seller rejection is no longer used in the current order flow.",
    },
  });
});

ordersRouter.post("/:id/cancel", requireAuth("app"), async (req, res) => {
  req.body = { toStatus: "cancelled", reason: req.body?.reason };
  return transitionHandler(req, res, "order_cancel");
});

ordersRouter.post("/:id/status", requireAuth("app"), async (req, res) => {
  return transitionHandler(req, res, "status_update");
});

async function transitionHandler(
  req: Request,
  res: Response,
  eventType: string
) {
  const actorRole = resolveActorRole(req);
  if (!actorRole) {
    return res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Missing actor role. For both-role users, set x-actor-role to buyer or seller.",
      },
    });
  }

  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { toStatus, reason } = parsed.data;

  const client = await pool.connect();
  const pushQueue: PushNotificationPayload[] = [];
  let committed = false;
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<OrderRow>(
      `SELECT id, buyer_id, seller_id, status, total_price::text, payment_completed, delivery_type, delivery_address_json, estimated_delivery_time::text
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    );

    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const order = orderResult.rows[0];

    if (isTerminalStatus(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_TERMINAL", message: "Order is already terminal" } });
    }

    if (actorRole === "seller" && order.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
    }
    if (actorRole === "buyer" && order.buyer_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not buyer of this order" } });
    }

    let currentStatus: OrderStatus = order.status;
    const canAutoMarkPaidForTest =
      actorRole === "seller" &&
      toStatus === "preparing" &&
      env.PAYMENT_PROVIDER_NAME === "mockpay" &&
      !order.payment_completed &&
      ["pending_seller_approval", "seller_approved", "awaiting_payment"].includes(order.status);

    if (canAutoMarkPaidForTest) {
      await client.query(
        "UPDATE orders SET status = 'paid', payment_completed = TRUE, updated_at = now() WHERE id = $1",
        [order.id]
      );
      await client.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
         VALUES ($1, $2, 'payment_test_bypass', $3, 'paid', $4)`,
        [order.id, req.auth!.userId, order.status, JSON.stringify({ mode: "mockpay_test" })]
      );
      currentStatus = "paid";
    }

    if (!canActorSetStatus(actorRole, toStatus, order.delivery_type)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Actor cannot set target status" } });
    }

    if (!canTransition(currentStatus, toStatus)) {
      if (
        normalizeDeliveryType(order.delivery_type) === "pickup" &&
        isPickupParallelNoopAllowed(currentStatus, toStatus)
      ) {
        await client.query("COMMIT");
        committed = true;
        return res.json({ data: { orderId: order.id, fromStatus: currentStatus, toStatus: currentStatus } });
      }
      if (
        normalizeDeliveryType(order.delivery_type) === "pickup" &&
        actorRole === "buyer" &&
        isPickupBuyerParallelTransitionAllowed(currentStatus, toStatus)
      ) {
        // pickup mode: buyer progress can start without waiting seller status chain
      } else {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: { code: "ORDER_INVALID_STATE", message: `Cannot transition ${currentStatus} -> ${toStatus}` },
        });
      }
    }

    if (toStatus === "cancelled" && actorRole === "buyer") {
      if (!["pending_seller_approval", "seller_approved", "awaiting_payment", "paid"].includes(currentStatus)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: { code: "ORDER_CANCEL_POLICY", message: "Buyer cancellation allowed only before preparing" },
        });
      }
    }

    if (toStatus === "completed") {
      // Use a savepoint so a failure here (e.g. missing migration table) rolls back only this
      // sub-operation and leaves the outer transaction usable.
      await client.query("SAVEPOINT before_allergen_backfill");
      try {
        const missingPhases = await ensureAllergenDisclosuresForCompletionTx(client, order);
        if (missingPhases.length > 0) {
          await client.query(
            `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
             VALUES ($1, $2, 'allergen_disclosure_backfill', $3, $4, $5)`,
            [order.id, req.auth!.userId, currentStatus, currentStatus, JSON.stringify({ phases: missingPhases })],
          );
        }
        await client.query("RELEASE SAVEPOINT before_allergen_backfill");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT before_allergen_backfill");
        await client.query("RELEASE SAVEPOINT before_allergen_backfill");
        if (error instanceof Error && error.message === "ORDER_INVALID_ITEMS") {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: { code: "ORDER_INVALID_ITEMS", message: "Order items missing" } });
        }
        // Completion must not be blocked by non-critical disclosure backfill failures.
        console.error("[orders] allergen disclosure backfill failed (non-fatal)", {
          orderId: order.id,
          actorUserId: req.auth?.userId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (toStatus === "completed" && normalizeDeliveryType(order.delivery_type) === "pickup") {
      const hasProofTable = await tableExistsTx(client, "public.delivery_proof_records");
      if (!hasProofTable) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: {
            code: "DELIVERY_PIN_REQUIRED",
            message: "Pickup completion requires verified PIN",
          },
        });
      }
      const proof = await client.query<{ status: string }>(
        "SELECT status FROM delivery_proof_records WHERE order_id = $1",
        [order.id]
      );
      if ((proof.rowCount ?? 0) === 0 || proof.rows[0].status !== "verified") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: {
            code: "DELIVERY_PIN_REQUIRED",
            message: "Pickup completion requires verified PIN",
          },
        });
      }
    }

    const skipProofCheck = env.PAYMENT_PROVIDER_NAME === "mockpay";
    if (!skipProofCheck && toStatus === "completed" && order.delivery_type === "delivery") {
      const hasProofTable = await tableExistsTx(client, "public.delivery_proof_records");
      if (!hasProofTable) {
        console.warn("[orders] delivery proof table missing, skipping proof check", {
          orderId: order.id,
          toStatus,
        });
      } else {
        const proof = await client.query<{ status: string }>(
          "SELECT status FROM delivery_proof_records WHERE order_id = $1",
          [order.id]
        );
        if ((proof.rowCount ?? 0) === 0 || proof.rows[0].status !== "verified") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: {
              code: "DELIVERY_PIN_REQUIRED",
              message: "Order completion requires verified PIN",
            },
          });
        }
      }
    }

    if (!skipProofCheck && toStatus === "delivered" && order.delivery_type === "delivery") {
      const hasProofTable = await tableExistsTx(client, "public.delivery_proof_records");
      if (hasProofTable) {
        const proof = await client.query<{ status: string }>(
          "SELECT status FROM delivery_proof_records WHERE order_id = $1",
          [order.id]
        );
        if ((proof.rowCount ?? 0) === 0 || proof.rows[0].status !== "verified") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: {
              code: "DELIVERY_PIN_REQUIRED",
              message: "Teslimat kodu doğrulanmadan teslim edildi işaretlenemez",
            },
          });
        }
      }
    }

    await client.query("UPDATE orders SET status = $1, updated_at = now() WHERE id = $2", [toStatus, order.id]);
    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, req.auth!.userId, eventType, currentStatus, toStatus, reason ? JSON.stringify({ reason }) : null]
    );

    if (toStatus === "preparing") {
      try {
        await allocateLotsFefoTx({ client, orderId: order.id, sellerId: order.seller_id });
        await emitOrderMilestoneTx(
          client,
          { orderId: order.id, buyerId: order.buyer_id, milestone: "order_preparing" },
          pushQueue,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "LOT_ALLOCATE_FAILED";
        if (msg.startsWith("INSUFFICIENT_LOT_STOCK:")) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: { code: "LOT_STOCK_INSUFFICIENT", message: "Not enough lot stock for preparing transition" },
          });
        }
        throw error;
      }
    }

    if (toStatus === "in_delivery" && order.delivery_type === "delivery") {
      let destination = extractLatLng(order.delivery_address_json);
      if (!destination) {
        const addrLine = extractAddressLine(order.delivery_address_json);
        if (addrLine) {
          destination = await geocodeAddress(addrLine);
        }
      }

      let routeDurationSec: number | null = null;
      const latestSellerLoc = await client.query<{ latitude: string; longitude: string }>(
        `SELECT latitude::text, longitude::text
         FROM order_delivery_tracking
         WHERE order_id = $1
         ORDER BY captured_at DESC
         LIMIT 1`,
        [order.id],
      );
      if (destination && (latestSellerLoc.rowCount ?? 0) > 0) {
        const origin: LatLng = {
          lat: Number(latestSellerLoc.rows[0].latitude),
          lng: Number(latestSellerLoc.rows[0].longitude),
        };
        routeDurationSec = await estimateRouteDurationSeconds(origin, destination);
      }
      if (routeDurationSec !== null) {
        const eta = new Date(Date.now() + routeDurationSec * 1000);
        await client.query("UPDATE orders SET estimated_delivery_time = $1, updated_at = now() WHERE id = $2", [eta, order.id]);
        await emitEtaMilestonesTx(
          client,
          { orderId: order.id, buyerId: order.buyer_id, remainingSeconds: routeDurationSec, routeDurationSec },
          pushQueue,
        );
      }

      await emitOrderMilestoneTx(
        client,
        { orderId: order.id, buyerId: order.buyer_id, milestone: "order_in_delivery" },
        pushQueue,
      );
    }

    if (toStatus === "at_door" && order.delivery_type === "delivery") {
      const pin = randomDeliveryPin();
      const pinHash = sha256Hex(pin);
      await client.query(
        `INSERT INTO delivery_proof_records
          (order_id, seller_id, buyer_id, proof_mode, pin_hash, pin_sent_at, pin_sent_channel, verification_attempts, status, metadata_json, created_at)
         VALUES ($1, $2, $3, 'pin', $4, now(), 'in_app', 0, 'pending', $5, now())
         ON CONFLICT (order_id)
         DO UPDATE SET
           pin_hash = EXCLUDED.pin_hash,
           pin_sent_at = now(),
           pin_sent_channel = 'in_app',
           verification_attempts = 0,
           status = 'pending',
           metadata_json = EXCLUDED.metadata_json`,
        [order.id, order.seller_id, order.buyer_id, pinHash, JSON.stringify({ ttlMinutes: 10, buyerPin: pin })]
      );
      await client.query(
        `INSERT INTO notification_events (user_id, type, title, body, data_json, is_read, created_at)
         VALUES ($1, 'delivery_pin', 'Delivery PIN', $2, $3, FALSE, now())`,
        [order.buyer_id, `Your delivery PIN is ${pin}`, JSON.stringify({ orderId: order.id })]
      );
      await enqueueOutboxEvent(client, {
        eventType: "delivery_pin_sent",
        aggregateType: "order",
        aggregateId: order.id,
        payload: { orderId: order.id, buyerId: order.buyer_id },
      });
    }

    if (toStatus === "at_door" && normalizeDeliveryType(order.delivery_type) === "pickup") {
      const pin = randomDeliveryPin();
      const pinHash = sha256Hex(pin);
      await client.query(
        `INSERT INTO delivery_proof_records
          (order_id, seller_id, buyer_id, proof_mode, pin_hash, pin_sent_at, pin_sent_channel, verification_attempts, status, metadata_json, created_at)
         VALUES ($1, $2, $3, 'pin', $4, now(), 'in_app', 0, 'pending', $5, now())
         ON CONFLICT (order_id)
         DO UPDATE SET
           pin_hash = EXCLUDED.pin_hash,
           pin_sent_at = now(),
           pin_sent_channel = 'in_app',
           verification_attempts = 0,
           status = 'pending',
           metadata_json = EXCLUDED.metadata_json`,
        [order.id, order.seller_id, order.buyer_id, pinHash, JSON.stringify({ ttlMinutes: 10, buyerPin: pin })]
      );
      await client.query(
        `INSERT INTO notification_events (user_id, type, title, body, data_json, is_read, created_at)
         VALUES ($1, 'delivery_pin', 'Pickup PIN', $2, $3, FALSE, now())`,
        [order.buyer_id, `Your pickup PIN is ${pin}`, JSON.stringify({ orderId: order.id })]
      );
      await enqueueOutboxEvent(client, {
        eventType: "delivery_pin_sent",
        aggregateType: "order",
        aggregateId: order.id,
        payload: { orderId: order.id, buyerId: order.buyer_id },
      });
    }

    if (toStatus === "completed") {
      try {
        await finalizeOrderFinanceTx({
          client,
          orderId: order.id,
          sellerId: order.seller_id,
          grossAmount: Number(order.total_price),
        });
        await enqueueOutboxEvent(client, {
          eventType: "finance_snapshot_finalized",
          aggregateType: "order_finance",
          aggregateId: order.id,
          payload: { orderId: order.id, sellerId: order.seller_id, grossAmount: Number(order.total_price) },
        });
      } catch (error) {
        // Finance snapshot is non-blocking for buyer confirmation.
        console.error("[orders] finance finalize failed (non-fatal)", {
          orderId: order.id,
          sellerId: order.seller_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await enqueueOutboxEvent(client, {
          eventType: "order_completed",
          aggregateType: "order",
          aggregateId: order.id,
          payload: { orderId: order.id },
        });
      } catch (error) {
        // Outbox should not block completion confirmation on mobile flow.
        console.error("[orders] order_completed outbox enqueue failed (non-fatal)", {
          orderId: order.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await client.query("COMMIT");
    committed = true;
    if (pushQueue.length > 0) {
      try {
        await flushPushNotifications(pushQueue);
      } catch (pushErr) {
        console.error("[orders] push flush failed after transition commit", pushErr);
      }
    }
    return res.json({ data: { orderId: order.id, fromStatus: currentStatus, toStatus } });
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    console.error("[orders] transition failed", {
      orderId: req.params.id,
      actorRole,
      actorUserId: req.auth?.userId ?? null,
      toStatus,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Order transition failed" } });
  } finally {
    client.release();
  }
}
