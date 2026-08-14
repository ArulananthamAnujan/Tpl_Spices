import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OrderItem {
  variation_id: string;
  qty: number;
  name_snapshot: string;
}

interface CreateOrderPayload {
  store_id: string;
  fulfillment_type: "PICKUP" | "DELIVERY";
  items: OrderItem[];
  delivery_address?: {
    street: string;
    suburb: string;
    state: string;
    postcode: string;
  } | null;
  scheduled_time?: string | null;
  notes?: string | null;
  payment_token: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    // Authenticated Supabase client (to identify the user)
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser();
    if (!user || authErr) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client for writing orders
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payload: CreateOrderPayload = await req.json();
    const { store_id, fulfillment_type, items, delivery_address, scheduled_time, notes, payment_token } = payload;

    if (!store_id || !fulfillment_type || !items?.length || !payment_token) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const item of items) {
      if (!item.variation_id || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999) {
        return new Response(JSON.stringify({ error: "Invalid item in cart" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get store's Square location ID
    const { data: store, error: storeErr } = await supabaseAdmin
      .from("stores")
      .select("square_location_id, pickup_enabled, delivery_enabled, delivery_fee_cents")
      .eq("id", store_id)
      .maybeSingle();

    if (!store || storeErr) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (fulfillment_type === "PICKUP" && !store.pickup_enabled) {
      return new Response(JSON.stringify({ error: "Pickup not available at this store" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (fulfillment_type === "DELIVERY" && !store.delivery_enabled) {
      return new Response(JSON.stringify({ error: "Delivery not available at this store" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up authoritative prices server-side — never trust a price the client sends.
    const variationIds = [...new Set(items.map(i => i.variation_id))];
    const { data: variations, error: variationsErr } = await supabaseAdmin
      .from("product_variations")
      .select("id, price_cents, product_id, products!inner(active)")
      .in("id", variationIds);

    if (variationsErr) {
      return new Response(JSON.stringify({ error: "Failed to price cart items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceById = new Map<string, number>();
    for (const v of variations ?? []) {
      const product = Array.isArray((v as any).products) ? (v as any).products[0] : (v as any).products;
      if (product?.active === false) continue; // don't sell delisted items
      priceById.set(v.id, v.price_cents);
    }

    for (const item of items) {
      if (!priceById.has(item.variation_id)) {
        return new Response(JSON.stringify({ error: "One or more items in your cart are no longer available. Please refresh your cart." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Stock check — only enforced for variations with a tracked inventory row at this store.
    // Untracked variations (no row) are treated as available, matching current catalog data.
    const { data: inventoryRows } = await supabaseAdmin
      .from("store_inventory")
      .select("variation_id, quantity")
      .eq("store_id", store_id)
      .in("variation_id", variationIds);

    const stockById = new Map<string, number>((inventoryRows ?? []).map(r => [r.variation_id, r.quantity]));
    for (const item of items) {
      const stock = stockById.get(item.variation_id);
      if (stock !== undefined && stock < item.qty) {
        return new Response(JSON.stringify({ error: "Not enough stock for one or more items. Please adjust your cart." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const squareToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
    const squareEnv = Deno.env.get("SQUARE_ENV") ?? "sandbox";
    const squareBase = squareEnv === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

    const squareHeaders = {
      "Authorization": `Bearer ${squareToken}`,
      "Square-Version": "2026-05-20",
      "Content-Type": "application/json",
    };

    const idempotencyKey = crypto.randomUUID();

    // Calculate totals using authoritative server-side prices only
    const subtotalCents = items.reduce((sum, i) => sum + priceById.get(i.variation_id)! * i.qty, 0);
    const deliveryFeeCents = fulfillment_type === "DELIVERY" ? (store.delivery_fee_cents ?? 0) : 0;

    // Build Square line items
    const lineItems = items.map(item => ({
      quantity: String(item.qty),
      base_price_money: { amount: priceById.get(item.variation_id)!, currency: "AUD" },
      name: item.name_snapshot,
    }));

    if (deliveryFeeCents > 0) {
      lineItems.push({
        quantity: "1",
        base_price_money: { amount: deliveryFeeCents, currency: "AUD" },
        name: "Delivery fee",
      });
    }

    // Build Square fulfillment
    const squareFulfillment: any = {
      type: fulfillment_type,
      state: "PROPOSED",
    };

    if (fulfillment_type === "PICKUP") {
      squareFulfillment.pickup_details = {
        pickup_at: scheduled_time ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    } else {
      squareFulfillment.delivery_details = {
        deliver_at: scheduled_time ?? new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        ...(delivery_address ? {
          recipient: {
            display_name: "Customer",
            address: {
              address_line_1: delivery_address.street,
              locality: delivery_address.suburb,
              administrative_district_level_1: delivery_address.state,
              postal_code: delivery_address.postcode,
              country: "AU",
            },
          },
        } : {}),
      };
    }

    // Create Square order
    const orderRes = await fetch(`${squareBase}/v2/orders`, {
      method: "POST",
      headers: squareHeaders,
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        order: {
          location_id: store.square_location_id,
          line_items: lineItems,
          fulfillments: [squareFulfillment],
        },
      }),
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      const errMsg = orderData.errors?.[0]?.detail ?? JSON.stringify(orderData.errors);
      return new Response(JSON.stringify({ error: `Square order failed: ${errMsg}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const squareOrder = orderData.order;
    const squareOrderTotal = squareOrder.total_money?.amount ?? subtotalCents;

    // Create Square payment
    const paymentRes = await fetch(`${squareBase}/v2/payments`, {
      method: "POST",
      headers: squareHeaders,
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        source_id: payment_token,
        amount_money: { amount: squareOrderTotal, currency: "AUD" },
        order_id: squareOrder.id,
        location_id: store.square_location_id,
      }),
    });

    const paymentData = await paymentRes.json();
    if (!paymentRes.ok) {
      const errMsg = paymentData.errors?.[0]?.detail ?? JSON.stringify(paymentData.errors);
      return new Response(JSON.stringify({ error: `Payment failed: ${errMsg}` }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const squarePayment = paymentData.payment;

    // Persist order to Supabase using service role
    const { data: dbOrder, error: orderInsertErr } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: user.id,
        store_id,
        square_order_id: squareOrder.id,
        square_payment_id: squarePayment.id,
        fulfillment_type,
        status: "new",
        subtotal_cents: subtotalCents,
        total_cents: squareOrderTotal,
        delivery_address: delivery_address ?? null,
        scheduled_time: scheduled_time ?? null,
        notes: notes ?? null,
      })
      .select("id")
      .single();

    if (orderInsertErr || !dbOrder) {
      return new Response(JSON.stringify({ error: "Order saved in Square but failed to record locally: " + (orderInsertErr?.message ?? "") }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persist order items
    const orderItems = items.map(item => ({
      order_id: dbOrder.id,
      variation_id: item.variation_id,
      name_snapshot: item.name_snapshot,
      qty: item.qty,
      unit_price_cents: priceById.get(item.variation_id)!,
    }));

    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(orderItems);
    if (itemsErr) {
      console.error("order_items insert error:", itemsErr.message);
    }

    // Decrement tracked inventory (best-effort — payment already succeeded, so we log
    // rather than fail the order if this doesn't apply cleanly under concurrent orders).
    for (const item of items) {
      if (!stockById.has(item.variation_id)) continue; // untracked, nothing to decrement
      const { error: stockErr } = await supabaseAdmin.rpc("decrement_store_inventory", {
        p_store_id: store_id,
        p_variation_id: item.variation_id,
        p_qty: item.qty,
      });
      if (stockErr) console.error("inventory decrement error:", stockErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, order_id: dbOrder.id, square_order_id: squareOrder.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
