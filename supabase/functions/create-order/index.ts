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

    const bad = (msg: string) => new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const shortText = (v: unknown, max: number) => v == null || (typeof v === "string" && v.length <= max);
    if (!UUID.test(String(store_id))) return bad("Invalid store");
    if (fulfillment_type !== "PICKUP" && fulfillment_type !== "DELIVERY") return bad("Invalid fulfillment type");
    if (!Array.isArray(items) || items.length > 100) return bad("Too many items in cart");
    if (typeof payment_token !== "string" || payment_token.length > 1000) return bad("Invalid payment details");
    if (!shortText(notes, 1000)) return bad("Notes are too long");
    if (scheduled_time != null && (typeof scheduled_time !== "string" || Number.isNaN(Date.parse(scheduled_time)))) {
      return bad("Invalid scheduled time");
    }
    if (delivery_address != null) {
      const a = delivery_address as Record<string, unknown>;
      if (typeof a !== "object" || !["street", "suburb", "state", "postcode"].every(k => shortText(a[k], 200))) {
        return bad("Invalid delivery address");
      }
    }

    for (const item of items) {
      if (!UUID.test(String(item.variation_id)) || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999) {
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

    // All payments route through one designated Square location regardless
    // of which store the order is fulfilled from — some stores' own Square
    // locations aren't configured correctly yet. Must match the frontend's
    // paymentLocationId logic in CheckoutPage.tsx.
    const { data: paymentStore } = await supabaseAdmin
      .from("stores")
      .select("square_location_id")
      .eq("is_payment_location", true)
      .maybeSingle();
    const paymentLocationId = paymentStore?.square_location_id ?? store.square_location_id;

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
      .select("id, name, price_cents, product_id, wholesale_price_cents, wholesale_min_qty, promo_type, promo_value, promo_start, promo_end, products!inner(active, name)")
      .in("id", variationIds);

    if (variationsErr) {
      return new Response(JSON.stringify({ error: "Failed to price cart items" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mirror of src/lib/pricing.ts — retail, then active promo, then the cheaper
    // of promo vs. the wholesale tier once the quantity threshold is reached.
    const varById = new Map<string, any>();
    for (const v of variations ?? []) {
      const product = Array.isArray((v as any).products) ? (v as any).products[0] : (v as any).products;
      if (product?.active === false) continue; // don't sell delisted items
      if (!(v.price_cents > 0)) continue; // no fixed price in Square — priced on request
      // Item names come from the catalogue, not from the browser.
      (v as any).display_name = `${product?.name ?? "Item"} – ${v.name}`;
      varById.set(v.id, v);
    }

    const promoPrice = (v: any): number => {
      const base = v.price_cents;
      if (!v.promo_type || v.promo_value == null) return base;
      const now = Date.now();
      if (v.promo_start && now < new Date(v.promo_start).getTime()) return base;
      if (v.promo_end && now > new Date(v.promo_end).getTime()) return base;
      let out = base;
      if (v.promo_type === "percent") out = Math.round((base * (100 - v.promo_value)) / 100);
      else if (v.promo_type === "fixed") out = base - v.promo_value;
      else if (v.promo_type === "price") out = v.promo_value;
      return Math.max(0, out);
    };
    const unitCentsFor = (variationId: string, qty: number): number => {
      const v = varById.get(variationId);
      if (!v) return 0;
      const candidates = [promoPrice(v)];
      if (v.wholesale_price_cents != null && v.wholesale_min_qty != null && v.wholesale_min_qty > 0 && qty >= v.wholesale_min_qty) {
        candidates.push(v.wholesale_price_cents);
      }
      return Math.max(0, Math.min(...candidates));
    };

    for (const item of items) {
      if (!varById.has(item.variation_id)) {
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
    const subtotalCents = items.reduce((sum, i) => sum + unitCentsFor(i.variation_id, i.qty) * i.qty, 0);
    const deliveryFeeCents = fulfillment_type === "DELIVERY" ? (store.delivery_fee_cents ?? 0) : 0;

    // Build Square line items
    const lineItems = items.map(item => ({
      quantity: String(item.qty),
      base_price_money: { amount: unitCentsFor(item.variation_id, item.qty), currency: "AUD" },
      name: varById.get(item.variation_id).display_name,
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
          location_id: paymentLocationId,
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
        location_id: paymentLocationId,
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
      name_snapshot: varById.get(item.variation_id).display_name,
      qty: item.qty,
      unit_price_cents: unitCentsFor(item.variation_id, item.qty),
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
        p_order_id: dbOrder.id,
      });
      if (stockErr) console.error("inventory decrement error:", stockErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, order_id: dbOrder.id, square_order_id: squareOrder.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("create-order error:", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: "Something went wrong placing your order. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
