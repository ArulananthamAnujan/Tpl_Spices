import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile || profile.role !== "super_admin") {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let bodyData: any = {};
    try { bodyData = await req.json(); } catch {}

    const squareToken = bodyData?.square_token || Deno.env.get("SQUARE_ACCESS_TOKEN");
    if (!squareToken) {
      return new Response(JSON.stringify({ error: "No Square access token provided." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const squareEnv = bodyData?.square_env || Deno.env.get("SQUARE_ENV") || "sandbox";
    const squareBase = squareEnv === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

    const squareHeaders = {
      "Authorization": `Bearer ${squareToken}`,
      "Square-Version": "2025-01-23",
      "Content-Type": "application/json",
    };

    // Use catalog/list which is more reliable than catalog/search
    let cursor: string | null = null;
    const allObjects: any[] = [];

    do {
      const url = new URL(`${squareBase}/v2/catalog/list`);
      url.searchParams.set("types", "CATEGORY,ITEM,ITEM_VARIATION,IMAGE");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: squareHeaders,
      });

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: `Square API error (${res.status}): ${err}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await res.json();
      const objects = data.objects ?? [];
      allObjects.push(...objects);
      cursor = data.cursor ?? null;
    } while (cursor);

    // Type breakdown for debugging
    const typeCounts: Record<string, number> = {};
    for (const o of allObjects) {
      typeCounts[o.type] = (typeCounts[o.type] ?? 0) + 1;
    }

    // If debug mode requested, return raw counts without writing to DB
    if (bodyData?.debug) {
      return new Response(
        JSON.stringify({ debug: true, total: allObjects.length, byType: typeCounts, squareBase }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Separate by type
    const squareCategories = allObjects.filter(o => o.type === "CATEGORY");
    const squareItems = allObjects.filter(o => o.type === "ITEM");
    const squareVariations = allObjects.filter(o => o.type === "ITEM_VARIATION");
    const squareImages = allObjects.filter(o => o.type === "IMAGE");

    const imageMap: Record<string, string> = {};
    for (const img of squareImages) {
      if (img.image_data?.url) imageMap[img.id] = img.image_data.url;
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Supabase returns at most 1000 rows per query, so read whole tables in
    // pages — otherwise products beyond the first 1000 silently lose their
    // prices, photos and stock during the sync.
    const fetchAll = async (
      table: string,
      columns: string,
      filter?: (q: any) => any,
      orderBy: string[] = ["id"],
    ) => {
      const rows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        let query: any = supabaseAdmin.from(table).select(columns);
        for (const col of orderBy) query = query.order(col);
        query = query.range(from, from + pageSize - 1);
        if (filter) query = filter(query);
        const { data, error } = await query;
        if (error) throw new Error(`${table} read: ${error.message}`);
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return rows;
    };

    // Upsert categories
    let catCount = 0;
    if (squareCategories.length > 0) {
      const cats = squareCategories.map((c, i) => ({
        square_id: c.id,
        name: c.category_data?.name ?? "Unknown",
        sort_order: i,
      }));
      const { error } = await supabaseAdmin
        .from("categories")
        .upsert(cats, { onConflict: "square_id" });
      if (error) throw new Error("categories upsert: " + error.message);
      catCount = cats.length;
    }

    const dbCats = await fetchAll("categories", "id, square_id");
    const catMap: Record<string, string> = {};
    for (const c of dbCats ?? []) catMap[c.square_id] = c.id;

    // Upsert products. image_url is intentionally left out here — Square often has
    // no photo for an item, and writing null would wipe out a manually uploaded or
    // AI-generated photo already saved on the product. Images with a Square photo
    // are updated separately below.
    let prodCount = 0;
    if (squareItems.length > 0) {
      const prods = squareItems.map(item => {
        const itemData = item.item_data ?? {};
        const categorySquareId = itemData.category_id ?? itemData.categories?.[0]?.id ?? null;
        return {
          square_item_id: item.id,
          name: itemData.name ?? "Unknown",
          category_id: categorySquareId ? (catMap[categorySquareId] ?? null) : null,
          active: !item.is_deleted,
        };
      });
      const { error } = await supabaseAdmin
        .from("products")
        .upsert(prods, { onConflict: "square_item_id" });
      if (error) throw new Error("products upsert: " + error.message);
      prodCount = prods.length;
    }

    // Only set image_url from Square for products that don't already have a
    // photo. Once a photo is set — whether from Square, uploaded by hand, or
    // AI-generated — a later sync never overwrites it, so curated photos
    // survive syncs even if Square happens to have its own image too.
    const productsMissingPhoto = await fetchAll("products", "id, square_item_id", q => q.is("image_url", null));
    const missingPhotoIds = new Set((productsMissingPhoto ?? []).map(p => p.square_item_id));

    const imageUpdates = squareItems
      .filter(item => missingPhotoIds.has(item.id))
      .map(item => {
        const itemData = item.item_data ?? {};
        const imageId = item.image_ids?.[0] ?? itemData.image_ids?.[0] ?? null;
        const imageUrl = imageId ? imageMap[imageId] : null;
        return imageUrl ? { square_item_id: item.id, image_url: imageUrl } : null;
      })
      .filter(Boolean) as { square_item_id: string; image_url: string }[];

    if (imageUpdates.length > 0) {
      const { error } = await supabaseAdmin
        .from("products")
        .upsert(imageUpdates, { onConflict: "square_item_id" });
      if (error) throw new Error("product images upsert: " + error.message);
    }

    const dbProds = await fetchAll("products", "id, square_item_id");
    const prodMap: Record<string, string> = {};
    for (const p of dbProds ?? []) prodMap[p.square_item_id] = p.id;

    // The payment-location store is treated as the one real Square location
    // (see the inventory sync below); its price is preferred when an item is
    // priced per location.
    const { data: allStores } = await supabaseAdmin
      .from("stores")
      .select("id, square_location_id, is_payment_location");
    const refStore = (allStores ?? []).find(s => s.is_payment_location) ?? (allStores ?? [])[0];

    // Variations come back as top-level objects, but also nested inside each
    // item — merge both so none are missed.
    const variationById = new Map<string, any>();
    for (const item of squareItems) {
      for (const v of item.item_data?.variations ?? []) variationById.set(v.id, v);
    }
    for (const v of squareVariations) variationById.set(v.id, v);

    // When a price is set per location in Square ("Price by location"), the
    // variation's base price_money is empty and the real price lives in
    // location_overrides. Fall back to it so those items don't sync as $0.
    const resolvePrice = (vd: any): { amount: number; currency: string } | null => {
      if (vd.price_money?.amount != null) {
        return { amount: Number(vd.price_money.amount), currency: vd.price_money.currency ?? "AUD" };
      }
      const overrides = (vd.location_overrides ?? []).filter((o: any) => o.price_money?.amount != null);
      const override =
        overrides.find((o: any) => o.location_id === refStore?.square_location_id) ?? overrides[0];
      if (override) {
        return { amount: Number(override.price_money.amount), currency: override.price_money.currency ?? "AUD" };
      }
      return null;
    };

    // Upsert variations
    let varCount = 0;
    const unpriced: string[] = [];
    const itemNameById: Record<string, string> = {};
    for (const item of squareItems) itemNameById[item.id] = item.item_data?.name ?? "Unknown";

    if (variationById.size > 0) {
      const vars = [...variationById.values()]
        .map(v => {
          const vd = v.item_variation_data ?? {};
          const productId = prodMap[vd.item_id ?? ""] ?? null;
          if (!productId) return null;
          const price = resolvePrice(vd);
          if (!price) unpriced.push(`${itemNameById[vd.item_id] ?? "Unknown"} (${vd.name ?? "Regular"})`);
          return {
            square_variation_id: v.id,
            product_id: productId,
            name: vd.name ?? "Regular",
            price_cents: price?.amount ?? 0,
            currency: price?.currency ?? "AUD",
          };
        })
        .filter(Boolean) as any[];

      if (vars.length > 0) {
        const { error } = await supabaseAdmin
          .from("product_variations")
          .upsert(vars, { onConflict: "square_variation_id" });
        if (error) throw new Error("variations upsert: " + error.message);
        varCount = vars.length;
      }
    }

    // Square items that came back with no variations at all show up on the
    // site as "Price on request" — list them so they can be checked in Square.
    const itemIdsWithVariations = new Set(
      [...variationById.values()].map(v => v.item_variation_data?.item_id)
    );
    const withoutVariations = squareItems
      .filter(item => !item.is_deleted && !itemIdsWithVariations.has(item.id))
      .map(item => itemNameById[item.id]);

    // Sync stock counts from Square Inventory, using whichever store is
    // flagged as the payment location as the one real Square location — the
    // same shared stock is then mirrored to every store, matching how this
    // business actually runs (one stockroom, multiple pickup/delivery points).
    let inventorySynced = 0;

    if (refStore?.square_location_id && (allStores ?? []).length > 0) {
      const dbVars = await fetchAll("product_variations", "id, square_variation_id");
      const squareIdToVarId: Record<string, string> = {};
      for (const v of dbVars ?? []) squareIdToVarId[v.square_variation_id] = v.id;
      const allSquareVarIds = Object.keys(squareIdToVarId);

      // Square counts from Square in chunks (API limit is 1000 object IDs per call).
      const squareQtyByVarId: Record<string, number> = {};
      for (let i = 0; i < allSquareVarIds.length; i += 1000) {
        const chunk = allSquareVarIds.slice(i, i + 1000);
        let invCursor: string | null = null;
        do {
          const invRes = await fetch(`${squareBase}/v2/inventory/counts/batch-retrieve`, {
            method: "POST",
            headers: squareHeaders,
            body: JSON.stringify({
              catalog_object_ids: chunk,
              location_ids: [refStore.square_location_id],
              ...(invCursor ? { cursor: invCursor } : {}),
            }),
          });
          if (!invRes.ok) break; // don't fail the whole sync over inventory
          const invData = await invRes.json();
          for (const count of invData.counts ?? []) {
            if (count.state !== "IN_STOCK") continue;
            const varId = squareIdToVarId[count.catalog_object_id];
            if (varId) squareQtyByVarId[varId] = parseInt(count.quantity, 10) || 0;
          }
          invCursor = invData.cursor ?? null;
        } while (invCursor);
      }

      const trackedVarIds = Object.keys(squareQtyByVarId);
      if (trackedVarIds.length > 0) {
        const currentInv = await fetchAll(
          "store_inventory", "store_id, variation_id, quantity", undefined, ["store_id", "variation_id"]
        );
        const currentByKey: Record<string, number> = {};
        for (const row of currentInv ?? []) currentByKey[`${row.store_id}:${row.variation_id}`] = row.quantity;

        const movements: any[] = [];
        for (const store of allStores ?? []) {
          for (const varId of trackedVarIds) {
            const squareQty = squareQtyByVarId[varId];
            const currentQty = currentByKey[`${store.id}:${varId}`] ?? 0;
            const delta = squareQty - currentQty;
            if (delta !== 0) {
              movements.push({
                store_id: store.id,
                variation_id: varId,
                delta,
                reason: "adjustment",
                note: "Square inventory sync",
              });
            }
          }
        }

        if (movements.length > 0) {
          const { error: movesErr } = await supabaseAdmin.from("inventory_movements").insert(movements);
          if (movesErr) throw new Error("inventory sync: " + movesErr.message);
          inventorySynced = movements.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        categories: catCount,
        products: prodCount,
        variations: varCount,
        unpricedVariations: unpriced,
        productsWithoutVariations: withoutVariations,
        inventoryAdjustments: inventorySynced,
        squareTotal: allObjects.length,
        byType: typeCounts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
