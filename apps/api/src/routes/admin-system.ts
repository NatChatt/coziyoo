import { readFile } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireSuperAdmin } from "../middleware/admin-rbac.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { hashPassword } from "../utils/security.js";
import { ensureUniqueUsername } from "../utils/username.js";

const ResetDatabaseSchema = z.object({
  confirmText: z.literal("RESET DATABASE"),
});

const SeedDemoDataSchema = z.object({
  confirmText: z.literal("SEED DEMO DATA"),
});

function demoFoodImageUrl(foodName: string): string {
  const normalized = foodName.toLowerCase();
  if (normalized.includes("tavuk") || normalized.includes("pilav")) {
    return "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80";
  }
  if (normalized.includes("sutlac") || normalized.includes("sütlaç")) {
    return "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80";
  }
  if (normalized.includes("fasulye")) {
    return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80";
  }
  return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80";
}

function demoComplianceFileUrl(code: string): string {
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `https://example.com/demo/compliance/${safeCode}.pdf`;
}

export const adminSystemRouter = Router();

adminSystemRouter.get("/system/version", requireAuth("admin"), async (_req, res) => {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch {
    commit = "unknown";
  }

  return res.json({
    data: {
      commit,
    },
  });
});

adminSystemRouter.post("/system/reset-database", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = ResetDatabaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: 'confirmText must be "RESET DATABASE"',
        details: parsed.error.flatten(),
      },
    });
  }

  const sqlPath = path.resolve(process.cwd(), "src/db/reset-and-init-schema.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);

  return res.json({
    data: {
      ok: true,
      message: "Database reset and schema reinitialized.",
    },
  });
});

adminSystemRouter.post("/system/seed-demo-data", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = SeedDemoDataSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: 'confirmText must be "SEED DEMO DATA"',
        details: parsed.error.flatten(),
      },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sellerEmail = "demo.seller@coziyoo.local";
    const buyerEmail = "demo.buyer@coziyoo.local";
    const defaultPassword = "Demo12345!";
    let complianceFallbackTypesCreated = 0;
    let complianceDocTypesActive = 0;
    let complianceDocsUpserted = 0;
    let foodsCreated = 0;
    let ordersCreated = 0;
    let sellersCreated = 0;

    async function ensureUser(args: {
      email: string;
      displayName: string;
      fullName: string;
      userType: "buyer" | "seller" | "both";
    }): Promise<string> {
      const existing = await client.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", [args.email]);
      if (existing.rowCount && existing.rows[0]) return existing.rows[0].id;

      const passwordHash = await hashPassword(defaultPassword);
      const uniqueUsername = await ensureUniqueUsername(client, {
        email: args.email,
        displayName: args.displayName,
      });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name, display_name_normalized, username, username_normalized, full_name, user_type, country_code, language, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'TR', 'tr', TRUE)
         RETURNING id::text`,
        [
          args.email,
          passwordHash,
          args.displayName,
          normalizeDisplayName(args.displayName),
          uniqueUsername.username,
          uniqueUsername.usernameNormalized,
          args.fullName,
          args.userType,
        ]
      );
      return inserted.rows[0].id;
    }

    const demoSellers = [
      {
        email: sellerEmail,
        displayName: "Demo Satici",
        fullName: "Demo Satici",
        foodNames: ["Tavuk Pilav", "Firin Sutlac", "Kuru Fasulye"],
      },
      {
        email: "demo.seller.plus@coziyoo.local",
        displayName: "Demo Satici Plus",
        fullName: "Demo Satici Plus",
        foodNames: ["Izgara Kofte", "Mercimek Corbasi", "Karisik Salata"],
      },
      {
        email: "demo.seller.risk@coziyoo.local",
        displayName: "Riskli Demo Satici",
        fullName: "Riskli Demo Satici",
        foodNames: ["Acili Tavuk", "Nohut Pilavi", "Kazandibi"],
      },
    ] as const;

    const sellerAccounts: Array<{ id: string; email: string; displayName: string; foodNames: readonly string[] }> = [];
    for (const seller of demoSellers) {
      const existingSeller = await client.query<{ id: string }>("SELECT id::text FROM users WHERE email = $1", [seller.email]);
      const sellerId =
        existingSeller.rowCount && existingSeller.rows[0]
          ? existingSeller.rows[0].id
          : await ensureUser({
              email: seller.email,
              displayName: seller.displayName,
              fullName: seller.fullName,
              userType: "seller",
            });
      if ((existingSeller.rowCount ?? 0) === 0) sellersCreated += 1;
      sellerAccounts.push({ id: sellerId, email: seller.email, displayName: seller.displayName, foodNames: seller.foodNames });
    }

    const buyerId = await ensureUser({
      email: buyerEmail,
      displayName: "Demo Alici",
      fullName: "Demo Alici",
      userType: "buyer",
    });

    // ── Extra buyer scenarios ──
    const demoBuyers = [
      {
        email: "can.aydin@coziyoo.local",
        displayName: "Can Aydin",
        fullName: "Can Aydin",
        phone: "+90 532 111 22 33",
        scenarios: [
          // Duzgun tamamlanan siparisler
          { status: "completed", paymentCompleted: true, hoursAgo: 24, sellerIdx: 0, foodIdx: 0, qty: 1, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 96, sellerIdx: 1, foodIdx: 1, qty: 2, deliveryType: "pickup" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 240, sellerIdx: 0, foodIdx: 2, qty: 1, deliveryType: "delivery" as const },
          // Aktif siparis
          { status: "preparing", paymentCompleted: true, hoursAgo: 0, sellerIdx: 2, foodIdx: 0, qty: 1, deliveryType: "delivery" as const },
          // Iptal edilen
          { status: "cancelled", paymentCompleted: false, hoursAgo: 48, sellerIdx: 1, foodIdx: 2, qty: 1, deliveryType: "delivery" as const },
        ],
        complaints: [
          { sellerIdx: 0, description: "Siparis 40 dakika gec geldi, yemek sogumtu.", priority: "medium" as const, status: "resolved" as const },
        ],
      },
      {
        email: "elif.demir@coziyoo.local",
        displayName: "Elif Demir",
        fullName: "Elif Demir",
        phone: "+90 544 222 33 44",
        scenarios: [
          { status: "completed", paymentCompleted: true, hoursAgo: 12, sellerIdx: 0, foodIdx: 1, qty: 1, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 72, sellerIdx: 2, foodIdx: 2, qty: 3, deliveryType: "pickup" as const },
          { status: "delivered", paymentCompleted: true, hoursAgo: 2, sellerIdx: 1, foodIdx: 0, qty: 1, deliveryType: "delivery" as const },
          // Odemesi beklenen siparis
          { status: "awaiting_payment", paymentCompleted: false, hoursAgo: 0, sellerIdx: 0, foodIdx: 0, qty: 2, deliveryType: "pickup" as const },
          // Iptal edilen siparis
          { status: "cancelled", paymentCompleted: false, hoursAgo: 36, sellerIdx: 2, foodIdx: 1, qty: 1, deliveryType: "delivery" as const },
        ],
        complaints: [
          { sellerIdx: 2, description: "Yanlis urun gonderildi, Nohut Pilavi yerine Acili Tavuk geldi.", priority: "high" as const, status: "open" as const },
          { sellerIdx: 2, description: "Siparis reddedildi ama sebep belirtilmedi.", priority: "low" as const, status: "in_review" as const },
        ],
      },
      {
        email: "ahmet.yilmaz@coziyoo.local",
        displayName: "Ahmet Yilmaz",
        fullName: "Ahmet Yilmaz",
        phone: "+90 555 333 44 55",
        scenarios: [
          { status: "completed", paymentCompleted: true, hoursAgo: 168, sellerIdx: 0, foodIdx: 0, qty: 2, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 336, sellerIdx: 1, foodIdx: 1, qty: 1, deliveryType: "pickup" as const },
          // Yolda olan
          { status: "in_delivery", paymentCompleted: true, hoursAgo: 0, sellerIdx: 0, foodIdx: 1, qty: 1, deliveryType: "delivery" as const },
          // 2 iptal — sorunlu alici senaryosu
          { status: "cancelled", paymentCompleted: false, hoursAgo: 24, sellerIdx: 1, foodIdx: 0, qty: 1, deliveryType: "delivery" as const },
          { status: "cancelled", paymentCompleted: false, hoursAgo: 72, sellerIdx: 2, foodIdx: 2, qty: 1, deliveryType: "delivery" as const },
          { status: "cancelled", paymentCompleted: false, hoursAgo: 120, sellerIdx: 0, foodIdx: 2, qty: 1, deliveryType: "pickup" as const },
        ],
        complaints: [
          { sellerIdx: 1, description: "Yemek paketi acik geldi, hijyen sorunu var.", priority: "high" as const, status: "open" as const },
          { sellerIdx: 0, description: "Teslimat suresi cok uzun, 1.5 saat beklendi.", priority: "medium" as const, status: "open" as const },
          { sellerIdx: 2, description: "Porsiyon cok kucuktu, fiyatina gore yetersiz.", priority: "low" as const, status: "resolved" as const },
        ],
      },
      {
        email: "zeynep.kara@coziyoo.local",
        displayName: "Zeynep Kara",
        fullName: "Zeynep Kara",
        phone: "+90 533 444 55 66",
        scenarios: [
          { status: "completed", paymentCompleted: true, hoursAgo: 6, sellerIdx: 1, foodIdx: 0, qty: 1, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 48, sellerIdx: 0, foodIdx: 2, qty: 2, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 144, sellerIdx: 2, foodIdx: 1, qty: 1, deliveryType: "pickup" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 360, sellerIdx: 1, foodIdx: 2, qty: 1, deliveryType: "delivery" as const },
          { status: "completed", paymentCompleted: true, hoursAgo: 480, sellerIdx: 0, foodIdx: 1, qty: 3, deliveryType: "pickup" as const },
        ],
        complaints: [],
      },
    ];

    const buyerAddresses = [
      { city: "Istanbul", district: "Kadikoy", line: "Caferaga Mah. Moda Cad. No:12/A" },
      { city: "Istanbul", district: "Besiktas", line: "Sinanpasa Mah. Ciragan Cad. No:5" },
      { city: "Istanbul", district: "Uskudar", line: "Altunizade Mah. Kisikli Cad. No:8" },
      { city: "Istanbul", district: "Sisli", line: "Mecidiyekoy Mah. Buyukdere Cad. No:22" },
      { city: "Istanbul", district: "Bakirkoy", line: "Atakoy 7-8 Kisim Mah." },
      { city: "Istanbul", district: "Fatih", line: "Sultanahmet Mah. Divanyolu Cad. No:3" },
    ];

    let buyersCreated = 0;
    let complaintsCreated = 0;
    for (const buyer of demoBuyers) {
      const bId = await ensureUser({ email: buyer.email, displayName: buyer.displayName, fullName: buyer.fullName, userType: "buyer" });
      // Set phone if user was just created
      await client.query(`UPDATE users SET phone = $1 WHERE id = $2 AND phone IS NULL`, [buyer.phone, bId]);
      buyersCreated += 1;

      // Check existing orders for this buyer
      const existingBuyerOrders = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1", [bId]
      );
      if (Number(existingBuyerOrders.rows[0]?.count ?? "0") > 0) continue;

      // Preload all seller foods
      const sellerFoodsMap = new Map<number, Array<{ id: string; price: string }>>();
      for (const [si, seller] of sellerAccounts.entries()) {
        const f = await client.query<{ id: string; price: string }>(
          "SELECT id::text, price::text FROM foods WHERE seller_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 4", [seller.id]
        );
        sellerFoodsMap.set(si, f.rows);
      }

      const createdOrderIds: string[] = [];
      for (const [sIdx, scenario] of buyer.scenarios.entries()) {
        const seller = sellerAccounts[scenario.sellerIdx];
        const foods = sellerFoodsMap.get(scenario.sellerIdx) ?? [];
        const food = foods[scenario.foodIdx % foods.length];
        if (!food || !seller) continue;

        const unitPrice = Number(food.price);
        const lineTotal = unitPrice * scenario.qty;
        const address = buyerAddresses[(sIdx) % buyerAddresses.length];

        const oi = await client.query<{ id: string }>(
          `INSERT INTO orders (buyer_id, seller_id, status, delivery_type, delivery_address_json, total_price, requested_at, payment_completed)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, now() - ($7::int * interval '1 hour'), $8)
           RETURNING id::text`,
          [bId, seller.id, scenario.status, scenario.deliveryType, JSON.stringify(address), lineTotal, scenario.hoursAgo, scenario.paymentCompleted]
        );
        const orderId = oi.rows[0].id;
        createdOrderIds.push(orderId);

        await client.query(
          `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total) VALUES ($1, $2, $3, $4, $5)`,
          [orderId, food.id, scenario.qty, unitPrice, lineTotal]
        );

        const eventFrom = scenario.status === "completed" ? "delivered" : scenario.status === "cancelled" ? "awaiting_payment" : "created";
        await client.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
           VALUES ($1, $2, 'status_update', $3, $4, $5::jsonb)`,
          [orderId, seller.id, eventFrom, scenario.status, JSON.stringify({ source: "admin_demo_seed" })]
        );
        ordersCreated += 1;
      }

      // Complaints for this buyer
      for (const [cIdx, complaint] of buyer.complaints.entries()) {
        const targetOrderId = createdOrderIds[cIdx % createdOrderIds.length];
        if (!targetOrderId) continue;

        const existingC = await client.query<{ id: string }>(
          `SELECT id::text FROM complaints WHERE order_id = $1 AND complainant_user_id = $2 AND description = $3 LIMIT 1`,
          [targetOrderId, bId, complaint.description]
        );
        if ((existingC.rowCount ?? 0) > 0) continue;

        await client.query(
          `INSERT INTO complaints (order_id, complainant_buyer_id, complainant_type, complainant_user_id, description, priority, status, created_at, updated_at)
           VALUES ($1, $2, 'buyer', $3, $4, $5, $6, now() - ($7::int * interval '1 hour'), now())`,
          [targetOrderId, bId, bId, complaint.description, complaint.priority, complaint.status, cIdx + 2]
        );
        complaintsCreated += 1;
      }
    }

    for (const [sellerIndex, seller] of sellerAccounts.entries()) {
      const existingFoods = await client.query<{ id: string; price: string }>(
        "SELECT id::text, price::text FROM foods WHERE seller_id = $1 AND is_active = TRUE ORDER BY created_at ASC",
        [seller.id]
      );

      if ((existingFoods.rowCount ?? 0) === 0) {
        for (const [foodIndex, name] of seller.foodNames.entries()) {
          const price = foodIndex === 0 ? 189.9 : foodIndex === 1 ? 129.9 : 159.9;
          await client.query(
            `INSERT INTO foods (seller_id, name, card_summary, description, country_code, price, image_url, is_active)
             VALUES ($1, $2, $3, $4, 'TR', $5, $6, TRUE)`,
            [seller.id, name, `${name} - Demo menu`, `${name} demo icerik`, price, demoFoodImageUrl(name)]
          );
          foodsCreated += 1;
        }
      }

      const foods = await client.query<{ id: string; price: string }>(
        "SELECT id::text, price::text FROM foods WHERE seller_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 4",
        [seller.id]
      );

      const existingOrderCount = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1 AND seller_id = $2",
        [buyerId, seller.id]
      );
      const orderCount = Number(existingOrderCount.rows[0]?.count ?? "0");

      if (orderCount === 0) {
        const orderStatuses: Array<{ status: string; paymentCompleted: boolean; hoursAgo: number; eventFrom: string; eventTo: string }> = [
          { status: "completed", paymentCompleted: true, hoursAgo: 48, eventFrom: "delivered", eventTo: "completed" },
          { status: "in_delivery", paymentCompleted: true, hoursAgo: 1, eventFrom: "ready", eventTo: "in_delivery" },
          { status: "preparing", paymentCompleted: true, hoursAgo: 0, eventFrom: "paid", eventTo: "preparing" },
          { status: "awaiting_payment", paymentCompleted: false, hoursAgo: 0, eventFrom: "created", eventTo: "awaiting_payment" },
          { status: "delivered", paymentCompleted: true, hoursAgo: 6, eventFrom: "in_delivery", eventTo: "delivered" },
          { status: "cancelled", paymentCompleted: false, hoursAgo: 24, eventFrom: "awaiting_payment", eventTo: "cancelled" },
          { status: "cancelled", paymentCompleted: false, hoursAgo: 72, eventFrom: "awaiting_payment", eventTo: "cancelled" },
          { status: "completed", paymentCompleted: true, hoursAgo: 120, eventFrom: "delivered", eventTo: "completed" },
          { status: "completed", paymentCompleted: true, hoursAgo: 168, eventFrom: "delivered", eventTo: "completed" },
        ];
        const addresses = [
          { city: "Istanbul", district: "Kadikoy", line: "Caferaga Mah. Moda Cad. No:12/A" },
          { city: "Istanbul", district: "Besiktas", line: "Sinanpasa Mah. Ciragan Cad. No:5" },
          { city: "Istanbul", district: "Uskudar", line: "Altunizade Mah. Kisikli Cad. No:8" },
          { city: "Istanbul", district: "Sisli", line: "Mecidiyekoy Mah. Buyukdere Cad. No:22" },
          { city: "Istanbul", district: "Bakirkoy", line: "Atakoy 7-8 Kisim Mah." },
        ];

        for (const [foodIndex, row] of foods.rows.entries()) {
          const statusDef = orderStatuses[(sellerIndex * foods.rows.length + foodIndex) % orderStatuses.length];
          const address = addresses[(sellerIndex + foodIndex) % addresses.length];
          const unitPrice = Number(row.price);
          const quantity = foodIndex === 0 ? 2 : 1;
          const lineTotal = unitPrice * quantity;
          const deliveryType = foodIndex % 2 === 0 ? "delivery" : "pickup";
          const orderInsert = await client.query<{ id: string }>(
            `INSERT INTO orders (buyer_id, seller_id, status, delivery_type, delivery_address_json, total_price, requested_at, payment_completed)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, now() - ($7::int * interval '1 hour'), $8)
             RETURNING id::text`,
            [buyerId, seller.id, statusDef.status, deliveryType, JSON.stringify(address), lineTotal, statusDef.hoursAgo, statusDef.paymentCompleted]
          );
          await client.query(
            `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
             VALUES ($1, $2, $3, $4, $5)`,
            [orderInsert.rows[0].id, row.id, quantity, unitPrice, lineTotal]
          );
          await client.query(
            `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
             VALUES ($1, $2, 'status_update', $3, $4, $5::jsonb)`,
            [orderInsert.rows[0].id, seller.id, statusDef.eventFrom, statusDef.eventTo, JSON.stringify({ source: "admin_demo_seed" })]
          );
          ordersCreated += 1;
        }
      }

      const seededOrders = await client.query<{ id: string }>(
        `SELECT id::text
         FROM orders
         WHERE buyer_id = $1
           AND seller_id = $2
         ORDER BY created_at ASC, id ASC`,
        [buyerId, seller.id]
      );

      const complaintSeeds = [
        {
          actorType: "buyer" as const,
          actorUserId: buyerId,
          actorBuyerId: buyerId,
          description: `${seller.displayName} icin demo alici sikayeti: siparis planlanan saate gore gec teslim edildi.`,
          priority: "medium" as const,
          status: "open" as const,
        },
        {
          actorType: "buyer" as const,
          actorUserId: buyerId,
          actorBuyerId: buyerId,
          description: `${seller.displayName} icin demo alici sikayeti: urun boyutu beklentiyi karsilamadi.`,
          priority: "low" as const,
          status: sellerIndex === 2 ? "in_review" as const : "resolved" as const,
        },
        {
          actorType: "seller" as const,
          actorUserId: seller.id,
          actorBuyerId: null,
          description: `${seller.displayName} icin demo satici sikayeti: teslimat aninda aliciya ulasilamadi.`,
          priority: sellerIndex === 2 ? "high" as const : "medium" as const,
          status: "open" as const,
        },
        {
          actorType: "seller" as const,
          actorUserId: seller.id,
          actorBuyerId: null,
          description: `${seller.displayName} icin demo satici sikayeti: odeme sonrasinda kapsamli siparis degisikligi talep edildi.`,
          priority: "high" as const,
          status: "in_review" as const,
        },
      ];

      for (const [index, order] of seededOrders.rows.entries()) {
        const seed = complaintSeeds[index];
        if (!seed) break;

        const existingComplaint = await client.query<{ id: string }>(
          `SELECT id::text
           FROM complaints
           WHERE order_id = $1
             AND complainant_type = $2
             AND complainant_user_id = $3
             AND description = $4
           LIMIT 1`,
          [order.id, seed.actorType, seed.actorUserId, seed.description]
        );
        if ((existingComplaint.rowCount ?? 0) > 0) continue;

        const insertedComplaint = await client.query<{ id: string }>(
          `INSERT INTO complaints (
             order_id,
             complainant_buyer_id,
             complainant_type,
             complainant_user_id,
             description,
             priority,
             status,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8::int * interval '1 hour'), now())
           RETURNING id::text`,
          [order.id, seed.actorBuyerId, seed.actorType, seed.actorUserId, seed.description, seed.priority, seed.status, index + 1]
        );
        complaintsCreated += insertedComplaint.rowCount ?? 0;
      }
    }

    const existingComplianceTypes = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM compliance_documents_list WHERE is_active = TRUE"
    );
    if (Number(existingComplianceTypes.rows[0]?.count ?? "0") === 0) {
      const fallbackTypes = [
        {
          code: "gida_isletme_kaydi",
          name: "Gida Isletme Kayit Belgesi",
          description: "TR gida mevzuatina uygun kayit belgesi",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: true,
        },
        {
          code: "vergi_levhasi",
          name: "Vergi Levhasi",
          description: "Guncel vergi levhasi",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: true,
        },
        {
          code: "kvkk_taahhut",
          name: "KVKK Taahhut",
          description: "KVKK sureclerine uyum taahhudu",
          sourceInfo: "Demo seed fallback",
          details: "Demo amacli olusturulmustur",
          isRequiredDefault: false,
        },
      ];

      for (const type of fallbackTypes) {
        const inserted = await client.query(
          `INSERT INTO compliance_documents_list (
             code,
             name,
             description,
             source_info,
             details,
             is_active,
             is_required_default,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, $5, TRUE, $6, now(), now())
           ON CONFLICT (code)
           DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             source_info = EXCLUDED.source_info,
             details = EXCLUDED.details,
             is_active = TRUE,
             is_required_default = EXCLUDED.is_required_default,
             updated_at = now()`,
          [type.code, type.name, type.description, type.sourceInfo, type.details, type.isRequiredDefault]
        );
        complianceFallbackTypesCreated += inserted.rowCount ?? 0;
      }
    }

    const activeComplianceTypes = await client.query<{ id: string; code: string; is_required_default: boolean; validity_years: number | null }>(
      `SELECT id::text, code, is_required_default, validity_years
       FROM compliance_documents_list
       WHERE is_active = TRUE
       ORDER BY code ASC`
    );
    complianceDocTypesActive = activeComplianceTypes.rowCount ?? 0;

    for (const type of activeComplianceTypes.rows) {
      for (const seller of sellerAccounts) {
        const current = await client.query<{
        id: string;
        version: number;
        is_required: boolean;
        file_url: string | null;
        uploaded_at: string | null;
        status: string;
      }>(
        `SELECT id::text, version, is_required, file_url, uploaded_at::text, status
         FROM seller_compliance_documents
         WHERE seller_id = $1
           AND document_list_id = $2
           AND is_current = TRUE
         FOR UPDATE`,
        [seller.id, type.id]
      );
      const demoUrl = demoComplianceFileUrl(type.code);
      let upserted;
      if ((current.rowCount ?? 0) === 0) {
        upserted = await client.query(
          `INSERT INTO seller_compliance_documents (
             seller_id,
             document_list_id,
             is_required,
             status,
             file_url,
             uploaded_at,
             reviewed_at,
             reviewed_by_admin_id,
             rejection_reason,
             notes,
             expires_at,
             expired,
             version,
             is_current,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, 'uploaded', $4, now(), NULL, NULL, NULL, 'admin_demo_seed', CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END, FALSE, 1, TRUE, now(), now())`,
          [seller.id, type.id, type.is_required_default, demoUrl, type.validity_years]
        );
      } else {
        const row = current.rows[0];
        const canReuseCurrentVersion =
          row.version === 1 &&
          row.file_url === null &&
          row.uploaded_at === null &&
          row.status === "requested";
        if (canReuseCurrentVersion) {
          upserted = await client.query(
            `UPDATE seller_compliance_documents
             SET
               is_required = $3,
               status = 'uploaded',
               file_url = $4,
               uploaded_at = now(),
               reviewed_at = NULL,
               reviewed_by_admin_id = NULL,
               rejection_reason = NULL,
               notes = 'admin_demo_seed',
               expires_at = CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END,
               expired = FALSE,
               updated_at = now()
             WHERE id = $1
               AND seller_id = $2`,
            [row.id, seller.id, type.is_required_default, demoUrl, type.validity_years]
          );
        } else {
          await client.query(
            `UPDATE seller_compliance_documents
             SET is_current = FALSE,
                 updated_at = now()
             WHERE id = $1`,
            [row.id]
          );
          upserted = await client.query(
            `INSERT INTO seller_compliance_documents (
               seller_id,
               document_list_id,
               is_required,
               status,
               file_url,
               uploaded_at,
               reviewed_at,
               reviewed_by_admin_id,
               rejection_reason,
               notes,
               expires_at,
               expired,
               version,
               is_current,
               created_at,
               updated_at
             )
             VALUES ($1, $2, $3, 'uploaded', $4, now(), NULL, NULL, NULL, 'admin_demo_seed', CASE WHEN $5 IS NOT NULL THEN now() + make_interval(years => $5) ELSE NULL END, FALSE, $6, TRUE, now(), now())`,
            [seller.id, type.id, type.is_required_default, demoUrl, type.validity_years, row.version + 1]
          );
        }
        }
        complianceDocsUpserted += upserted.rowCount ?? 0;
      }
    }

    await client.query("COMMIT");

    return res.json({
      data: {
        ok: true,
        sellerEmail,
        sellerEmails: sellerAccounts.map((seller) => seller.email),
        sellersCreated,
        buyersCreated,
        buyerEmail,
        defaultPassword,
        foodsCreated,
        ordersCreated,
        complaintsCreated,
        complianceDocTypesActive,
        complianceDocsUpserted,
        complianceFallbackTypesCreated,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
