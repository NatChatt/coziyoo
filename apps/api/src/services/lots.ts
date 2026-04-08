import type { PoolClient } from "pg";

async function markExpiredLotsForFoodTx(client: PoolClient, foodId: string): Promise<void> {
  await client.query(
    `UPDATE production_lots
     SET status = 'expired',
         updated_at = now()
     WHERE food_id = $1
       AND status = 'open'
       AND sale_ends_at < now()`,
    [foodId]
  );
}

export async function recalculateFoodStockTx(client: PoolClient, foodId: string): Promise<void> {
  await markExpiredLotsForFoodTx(client, foodId);
}

export async function allocateLotsFefoTx(params: {
  client: PoolClient;
  orderId: string;
  sellerId: string;
}): Promise<void> {
  const { client, orderId, sellerId } = params;
  const items = await client.query<{ id: string; lot_id: string | null; food_id: string; quantity: number }>(
    "SELECT id, lot_id, food_id, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at ASC",
    [orderId]
  );

  for (const item of items.rows) {
    await markExpiredLotsForFoodTx(client, item.food_id);
    if (!item.lot_id) {
      throw new Error(`INSUFFICIENT_LOT_STOCK:${item.food_id}`);
    }
    const lot = await client.query<{
      id: string;
      quantity_available: number;
      status: string;
      sale_starts_at: string;
      sale_ends_at: string;
    }>(
      `SELECT id, quantity_available, status, sale_starts_at::text, sale_ends_at::text
       FROM production_lots
       WHERE id = $1
         AND seller_id = $2
         AND food_id = $3
       FOR UPDATE`,
      [item.lot_id, sellerId, item.food_id]
    );
    if ((lot.rowCount ?? 0) === 0) {
      throw new Error(`INSUFFICIENT_LOT_STOCK:${item.food_id}`);
    }
    const selectedLot = lot.rows[0];
    if (
      selectedLot.status !== "open" ||
      new Date(selectedLot.sale_starts_at).getTime() > Date.now() ||
      new Date(selectedLot.sale_ends_at).getTime() < Date.now() ||
      Number(selectedLot.quantity_available) < Number(item.quantity)
    ) {
      throw new Error(`INSUFFICIENT_LOT_STOCK:${item.food_id}`);
    }
    await client.query(
      `INSERT INTO order_item_lot_allocations (order_id, order_item_id, lot_id, quantity_allocated, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [orderId, item.id, selectedLot.id, item.quantity]
    );
    await client.query(
      `UPDATE production_lots
       SET quantity_available = quantity_available - $2,
           status = CASE WHEN quantity_available - $2 <= 0 THEN 'depleted' ELSE status END,
           updated_at = now()
       WHERE id = $1`,
      [selectedLot.id, item.quantity]
    );

    await recalculateFoodStockTx(client, item.food_id);
  }
}
