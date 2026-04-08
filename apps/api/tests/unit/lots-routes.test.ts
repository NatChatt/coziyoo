import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConnect = vi.fn();
const mockPoolQuery = vi.fn();
const mockRecalculateFoodStockTx = vi.fn();
const mockEnqueueOutboxEvent = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  pool: {
    connect: mockConnect,
    query: mockPoolQuery,
  },
}));

vi.mock("../../src/services/lots.js", () => ({
  recalculateFoodStockTx: mockRecalculateFoodStockTx,
}));

vi.mock("../../src/services/outbox.js", () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}));

type FoodRow = {
  id: string;
  recipe: string | null;
  ingredients_json: unknown;
  allergens_json: unknown;
};

type LotRow = {
  id: string;
  seller_id: string;
  food_id: string;
  lot_number: string;
  recipe_snapshot: string | null;
  ingredients_snapshot_json: unknown;
  allergens_snapshot_json: unknown;
  quantity_produced: number;
  quantity_available: number;
  status: string;
  produced_at: string;
  sale_starts_at: string;
  sale_ends_at: string;
  use_by: string | null;
  best_before: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type MockState = {
  sellerId: string;
  food: FoodRow | null;
  lots: LotRow[];
};

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createClientQuery(state: MockState) {
  return vi.fn(async (sql: unknown, params: unknown[] = []) => {
    const q = normalizeSql(sql);
    if (q === "begin" || q === "commit" || q === "rollback") {
      return { rowCount: 0, rows: [] };
    }

    if (q.includes("from foods") && q.includes("where id = $1 and seller_id = $2")) {
      if (!state.food) return { rowCount: 0, rows: [] };
      if (params[0] !== state.food.id || params[1] !== state.sellerId) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [state.food] };
    }

    if (q.includes("insert into production_lots")) {
      const nowIso = new Date().toISOString();
      const newLot: LotRow = {
        id: "lot-1",
        seller_id: String(params[0]),
        food_id: String(params[1]),
        lot_number: String(params[2]),
        produced_at: String(params[3]),
        sale_starts_at: String(params[4]),
        sale_ends_at: String(params[5]),
        use_by: (params[6] as string | null) ?? null,
        best_before: (params[7] as string | null) ?? null,
        recipe_snapshot: (params[8] as string | null) ?? null,
        ingredients_snapshot_json: JSON.parse(String(params[9])),
        allergens_snapshot_json: JSON.parse(String(params[10])),
        quantity_produced: Number(params[11]),
        quantity_available: Number(params[12]),
        status: "open",
        notes: (params[13] as string | null) ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      state.lots.push(newLot);
      return { rowCount: 1, rows: [{ id: newLot.id, lot_number: newLot.lot_number }] };
    }

    if (q.includes("insert into lot_events")) {
      return { rowCount: 1, rows: [] };
    }

    if (q.includes("select food_id, seller_id, status, quantity_produced, sale_starts_at::text, sale_ends_at::text from production_lots where id = $1 for update")) {
      const lot = state.lots.find((item) => item.id === params[0]);
      if (!lot) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [
          {
            food_id: lot.food_id,
            seller_id: lot.seller_id,
            status: lot.status,
            quantity_produced: lot.quantity_produced,
            sale_starts_at: lot.sale_starts_at,
            sale_ends_at: lot.sale_ends_at,
          },
        ],
      };
    }

    if (q.includes("update production_lots") && q.includes("set quantity_available = $2")) {
      const lot = state.lots.find((item) => item.id === params[0]);
      if (lot) {
        lot.quantity_available = Number(params[1]);
        if (params[3] !== undefined && params[3] !== null) {
          lot.notes = String(params[3]);
        }
        lot.updated_at = new Date().toISOString();
      }
      return { rowCount: 1, rows: [] };
    }

    if (q.includes("select food_id, seller_id, status from production_lots where id = $1 for update")) {
      const lot = state.lots.find((item) => item.id === params[0]);
      if (!lot) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{ food_id: lot.food_id, seller_id: lot.seller_id, status: lot.status }],
      };
    }

    if (q.includes("update production_lots") && q.includes("set status = 'recalled'")) {
      const lot = state.lots.find((item) => item.id === params[0]);
      if (lot) {
        lot.status = "recalled";
        lot.quantity_available = 0;
        lot.notes = `${lot.notes ?? ""}\n[recall] ${String(params[1])}`.trim();
        lot.updated_at = new Date().toISOString();
      }
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unhandled SQL in test: ${q}`);
  });
}

function createPoolQuery(state: MockState) {
  return vi.fn(async (sql: unknown, params: unknown[] = []) => {
    const q = normalizeSql(sql);
    if (q.includes("from production_lots") && q.includes("where seller_id = $1")) {
      const sellerId = String(params[0]);
      const foodId = (params[1] as string | null) ?? null;
      const rows = state.lots
        .filter((lot) => lot.seller_id === sellerId)
        .filter((lot) => !foodId || lot.food_id === foodId)
        .map((lot) => ({
          id: lot.id,
          food_id: lot.food_id,
          lot_number: lot.lot_number,
          produced_at: lot.produced_at,
          sale_starts_at: lot.sale_starts_at,
          sale_ends_at: lot.sale_ends_at,
          use_by: lot.use_by,
          best_before: lot.best_before,
          recipe_snapshot: lot.recipe_snapshot,
          ingredients_snapshot_json: lot.ingredients_snapshot_json,
          allergens_snapshot_json: lot.allergens_snapshot_json,
          quantity_produced: lot.quantity_produced,
          quantity_available: lot.quantity_available,
          status: lot.status,
          lifecycle_status: "on_sale",
          notes: lot.notes,
          created_at: lot.created_at,
          updated_at: lot.updated_at,
        }));
      return { rowCount: rows.length, rows };
    }
    throw new Error(`Unhandled pool.query SQL in test: ${q}`);
  });
}

async function bootstrap(state: MockState) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("PGHOST", "127.0.0.1");
  vi.stubEnv("PGPORT", "5432");
  vi.stubEnv("PGUSER", "coziyoo");
  vi.stubEnv("PGPASSWORD", "coziyoo");
  vi.stubEnv("PGDATABASE", "coziyoo");
  vi.stubEnv("APP_JWT_SECRET", "test_app_jwt_secret_1234567890_abcdef");
  vi.stubEnv("ADMIN_JWT_SECRET", "test_admin_jwt_secret_1234567890_abcd");
  vi.stubEnv("PAYMENT_WEBHOOK_SECRET", "test_payment_webhook_secret_12345");

  const { default: express } = await import("express");
  const { sellerLotsRouter } = await import("../../src/routes/lots.js");
  const { signAccessToken } = await import("../../src/services/token-service.js");

  const clientQuery = createClientQuery(state);
  const poolQuery = createPoolQuery(state);
  mockConnect.mockResolvedValue({
    query: clientQuery,
    release: vi.fn(),
  });
  mockPoolQuery.mockImplementation(poolQuery);
  mockRecalculateFoodStockTx.mockResolvedValue(undefined);
  mockEnqueueOutboxEvent.mockResolvedValue(undefined);

  const app = express();
  app.use(express.json());
  app.use("/v1/seller/lots", sellerLotsRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;

  const token = signAccessToken({
    sub: state.sellerId,
    sessionId: "session-test",
    realm: "app",
    role: "seller",
  });

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
  };
}

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function lotCreatePayload(foodId: string) {
  return {
    foodId,
    producedAt: "2026-03-02T08:00:00.000Z",
    saleStartsAt: "2026-03-02T09:00:00.000Z",
    saleEndsAt: "2026-03-03T09:00:00.000Z",
    quantityProduced: 20,
    quantityAvailable: 15,
    notes: "batch created",
  };
}

beforeEach(() => {
  mockConnect.mockReset();
  mockPoolQuery.mockReset();
  mockRecalculateFoodStockTx.mockReset();
  mockEnqueueOutboxEvent.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seller lots routes snapshot enforcement", () => {
  it("blocks lot creation when recipe is missing", async () => {
    const state: MockState = {
      sellerId: "seller-1",
      food: { id: "11111111-1111-4111-8111-111111111111", recipe: null, ingredients_json: [{ name: "x" }], allergens_json: { milk: true } },
      lots: [],
    };
    const app = await bootstrap(state);

    try {
      const response = await fetch(`${app.baseUrl}/v1/seller/lots`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify(lotCreatePayload(state.food!.id)),
      });
      const body = (await response.json()) as { error?: { code?: string; details?: { missingFields?: string[] } } };
      expect(response.status).toBe(400);
      expect(body.error?.code).toBe("LOT_SNAPSHOT_REQUIRED");
      expect(body.error?.details?.missingFields).toContain("recipe");
    } finally {
      await shutdown(app.server);
    }
  });

  it("blocks lot creation when ingredients are missing", async () => {
    const state: MockState = {
      sellerId: "seller-1",
      food: { id: "11111111-1111-4111-8111-111111111111", recipe: "Tarif", ingredients_json: null, allergens_json: { milk: true } },
      lots: [],
    };
    const app = await bootstrap(state);

    try {
      const response = await fetch(`${app.baseUrl}/v1/seller/lots`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify(lotCreatePayload(state.food!.id)),
      });
      const body = (await response.json()) as { error?: { code?: string; details?: { missingFields?: string[] } } };
      expect(response.status).toBe(400);
      expect(body.error?.code).toBe("LOT_SNAPSHOT_REQUIRED");
      expect(body.error?.details?.missingFields).toContain("ingredients_json");
    } finally {
      await shutdown(app.server);
    }
  });

  it("blocks lot creation when allergens are missing", async () => {
    const state: MockState = {
      sellerId: "seller-1",
      food: { id: "11111111-1111-4111-8111-111111111111", recipe: "Tarif", ingredients_json: [{ name: "x" }], allergens_json: null },
      lots: [],
    };
    const app = await bootstrap(state);

    try {
      const response = await fetch(`${app.baseUrl}/v1/seller/lots`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify(lotCreatePayload(state.food!.id)),
      });
      const body = (await response.json()) as { error?: { code?: string; details?: { missingFields?: string[] } } };
      expect(response.status).toBe(400);
      expect(body.error?.code).toBe("LOT_SNAPSHOT_REQUIRED");
      expect(body.error?.details?.missingFields).toContain("allergens_json");
    } finally {
      await shutdown(app.server);
    }
  });

  it("creates lot and persists snapshots when required food fields exist", async () => {
    const state: MockState = {
      sellerId: "seller-1",
      food: {
        id: "11111111-1111-4111-8111-111111111111",
        recipe: "Tarif v1",
        ingredients_json: [{ name: "Un" }, { name: "Yumurta" }],
        allergens_json: { gluten: true, egg: true },
      },
      lots: [],
    };
    const app = await bootstrap(state);

    try {
      const createResponse = await fetch(`${app.baseUrl}/v1/seller/lots`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify(lotCreatePayload(state.food.id)),
      });
      expect(createResponse.status).toBe(201);

      const listResponse = await fetch(`${app.baseUrl}/v1/seller/lots`, {
        headers: { authorization: `Bearer ${app.token}` },
      });
      expect(listResponse.status).toBe(200);
      const body = (await listResponse.json()) as { data: Array<{ recipe_snapshot: string; ingredients_snapshot_json: unknown; allergens_snapshot_json: unknown }> };
      expect(body.data[0].recipe_snapshot).toBe("Tarif v1");
      expect(body.data[0].ingredients_snapshot_json).toEqual([{ name: "Un" }, { name: "Yumurta" }]);
      expect(body.data[0].allergens_snapshot_json).toEqual({ gluten: true, egg: true });
    } finally {
      await shutdown(app.server);
    }
  });

  it("keeps snapshots immutable after adjust", async () => {
    const lotId = "22222222-2222-4222-8222-222222222222";
    const state: MockState = {
      sellerId: "seller-1",
      food: null,
      lots: [
        {
          id: lotId,
          seller_id: "seller-1",
          food_id: "11111111-1111-4111-8111-111111111111",
          lot_number: "CZ-TEST-20260302-AAAA",
          recipe_snapshot: "Tarif immutable",
          ingredients_snapshot_json: [{ name: "Sut" }],
          allergens_snapshot_json: { milk: true },
          quantity_produced: 20,
          quantity_available: 10,
          status: "open",
          produced_at: "2026-03-02T08:00:00.000Z",
          sale_starts_at: "2026-03-02T09:00:00.000Z",
          sale_ends_at: "2026-03-03T09:00:00.000Z",
          use_by: null,
          best_before: null,
          notes: null,
          created_at: "2026-03-02T08:00:00.000Z",
          updated_at: "2026-03-02T08:00:00.000Z",
        },
      ],
    };
    const app = await bootstrap(state);

    try {
      const adjustResponse = await fetch(`${app.baseUrl}/v1/seller/lots/${lotId}/adjust`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify({ quantityAvailable: 5, notes: "stok düzeltme" }),
      });
      expect(adjustResponse.status).toBe(200);
      expect(state.lots[0].recipe_snapshot).toBe("Tarif immutable");
      expect(state.lots[0].ingredients_snapshot_json).toEqual([{ name: "Sut" }]);
      expect(state.lots[0].allergens_snapshot_json).toEqual({ milk: true });
    } finally {
      await shutdown(app.server);
    }
  });

  it("keeps snapshots immutable after recall", async () => {
    const lotId = "33333333-3333-4333-8333-333333333333";
    const state: MockState = {
      sellerId: "seller-1",
      food: null,
      lots: [
        {
          id: lotId,
          seller_id: "seller-1",
          food_id: "11111111-1111-4111-8111-111111111111",
          lot_number: "CZ-TEST-20260302-BBBB",
          recipe_snapshot: "Tarif immutable",
          ingredients_snapshot_json: [{ name: "Sut" }],
          allergens_snapshot_json: { milk: true },
          quantity_produced: 20,
          quantity_available: 10,
          status: "open",
          produced_at: "2026-03-02T08:00:00.000Z",
          sale_starts_at: "2026-03-02T09:00:00.000Z",
          sale_ends_at: "2026-03-03T09:00:00.000Z",
          use_by: null,
          best_before: null,
          notes: null,
          created_at: "2026-03-02T08:00:00.000Z",
          updated_at: "2026-03-02T08:00:00.000Z",
        },
      ],
    };
    const app = await bootstrap(state);

    try {
      const recallResponse = await fetch(`${app.baseUrl}/v1/seller/lots/${lotId}/recall`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${app.token}` },
        body: JSON.stringify({ reason: "allergen mismatch" }),
      });
      expect(recallResponse.status).toBe(200);
      expect(state.lots[0].recipe_snapshot).toBe("Tarif immutable");
      expect(state.lots[0].ingredients_snapshot_json).toEqual([{ name: "Sut" }]);
      expect(state.lots[0].allergens_snapshot_json).toEqual({ milk: true });
    } finally {
      await shutdown(app.server);
    }
  });
});
