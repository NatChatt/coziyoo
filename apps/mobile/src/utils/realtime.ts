import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

let singleton: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!singleton) {
    singleton = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return singleton;
}

export type RealtimeUnsubscribe = () => void;

export function subscribeBuyerFeedRealtime(onChange: () => void): RealtimeUnsubscribe {
  const client = getClient();
  if (!client) return () => {};

  const channel: RealtimeChannel = client
    .channel(`mobile-feed-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "foods" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "production_lots" }, onChange)
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeSellerOrdersRealtime(sellerId: string, onChange: () => void): RealtimeUnsubscribe {
  const client = getClient();
  const normalizedSellerId = String(sellerId ?? "").trim();
  if (!client || !normalizedSellerId) return () => {};

  const channel: RealtimeChannel = client
    .channel(`mobile-seller-orders-${normalizedSellerId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `seller_id=eq.${normalizedSellerId}` },
      onChange,
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeOrderRealtime(orderId: string, onChange: () => void): RealtimeUnsubscribe {
  const client = getClient();
  const normalizedOrderId = String(orderId ?? "").trim();
  if (!client || !normalizedOrderId) return () => {};

  const channel: RealtimeChannel = client
    .channel(`mobile-order-${normalizedOrderId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `id=eq.${normalizedOrderId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_delivery_tracking", filter: `order_id=eq.${normalizedOrderId}` },
      onChange,
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
