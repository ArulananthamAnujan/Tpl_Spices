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

    // A signed-in super admin is required. Previously the role check only ran
    // when a user was present, so an anonymous caller skipped it entirely and
    // could trigger a sync against the stored Square token.
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    // Upsert categories.
    // Categories renamed in the dashboard keep their local name — skip them so
    // the sync doesn't undo the shop's own naming.
    let catCount = 0;
    if (squareCategories.length > 0) {
      const { data: existingCats } = await supabaseAdmin
        .from("categories")
        .select("square_id, name_overridden");
      const renamedLocally = new Set(
        (existingCats ?? []).filter((c: any) => c.name_overridden).map((c: any) => c.square_id),
      );

      const cats = squareCategories
        .map((c, i) => ({
          square_id: c.id,
          name: c.category_data?.name ?? "Unknown",
          sort_order: i,
        }))
        .filter(c => !renamedLocally.has(c.square_id));

      if (cats.length > 0) {
        const { error } = await supabaseAdmin
          .from("categories")
          .upsert(cats, { onConflict: "square_id" });
        if (error) throw new Error("categories upsert: " + error.message);
      }
      catCount = cats.length;
    }

    const { data: dbCats } = await supabaseAdmin.from("categories").select("id, square_id");
    const catMap: Record<string, string> = {};
    for (const c of dbCats ?? []) catMap[c.square_id] = c.id;

    // Upsert products.
    // Products filed into a category/subcategory here keep that placement —
    // Square has no subcategories, so its category would otherwise win.
    let prodCount = 0;
    if (squareItems.length > 0) {
      const { data: existingProds } = await supabaseAdmin
        .from("products")
        .select("square_item_id, category_overridden");
      const categoryPinned = new Set(
        (existingProds ?? []).filter((p: any) => p.category_overridden).map((p: any) => p.square_item_id),
      );

      const base = squareItems.map(item => {
        const itemData = item.item_data ?? {};
        const categorySquareId = itemData.category_id ?? itemData.categories?.[0]?.id ?? null;
        const imageId = item.image_ids?.[0] ?? itemData.image_ids?.[0] ?? null;
        return {
          square_item_id: item.id,
          name: itemData.name ?? "Unknown",
          description: itemData.description ?? null,
          category_id: categorySquareId ? (catMap[categorySquareId] ?? null) : null,
          image_url: imageId ? (imageMap[imageId] ?? null) : null,
          active: !item.is_deleted,
        };
      });

      // Two passes so each payload has a uniform set of columns.
      const followSquare = base.filter(p => !categoryPinned.has(p.square_item_id));
      const keepCategory = base
        .filter(p => categoryPinned.has(p.square_item_id))
        .map(({ category_id: _ignored, ...rest }) => rest);

      if (followSquare.length > 0) {
        const { error } = await supabaseAdmin
          .from("products")
          .upsert(followSquare, { onConflict: "square_item_id" });
        if (error) throw new Error("products upsert: " + error.message);
      }
      if (keepCategory.length > 0) {
        const { error } = await supabaseAdmin
          .from("products")
          .upsert(keepCategory, { onConflict: "square_item_id" });
        if (error) throw new Error("products upsert (pinned category): " + error.message);
      }
      prodCount = base.length;
    }

    const { data: dbProds } = await supabaseAdmin.from("products").select("id, square_item_id");
    const prodMap: Record<string, string> = {};
    for (const p of dbProds ?? []) prodMap[p.square_item_id] = p.id;

    // Upsert variations
    let varCount = 0;
    if (squareVariations.length > 0) {
      const vars = squareVariations
        .map(v => {
          const vd = v.item_variation_data ?? {};
          const productId = prodMap[vd.item_id ?? ""] ?? null;
          if (!productId) return null;
          const amount = vd.price_money?.amount ?? 0;
          return {
            square_variation_id: v.id,
            product_id: productId,
            name: vd.name ?? "Regular",
            price_cents: Number(amount),
            currency: vd.price_money?.currency ?? "AUD",
          };
        })
        .filter(Boolean) as any[];

      if (vars.length > 0) {
        // Retail prices set in the dashboard win over Square's price.
        // (Wholesale and promo fields aren't in this payload, so they're
        // untouched either way.)
        const { data: existingVars } = await supabaseAdmin
          .from("product_variations")
          .select("square_variation_id, price_overridden");
        const pricePinned = new Set(
          (existingVars ?? []).filter((v: any) => v.price_overridden).map((v: any) => v.square_variation_id),
        );

        const followSquare = vars.filter(v => !pricePinned.has(v.square_variation_id));
        const keepPrice = vars
          .filter(v => pricePinned.has(v.square_variation_id))
          .map(({ price_cents: _ignored, ...rest }) => rest);

        if (followSquare.length > 0) {
          const { error } = await supabaseAdmin
            .from("product_variations")
            .upsert(followSquare, { onConflict: "square_variation_id" });
          if (error) throw new Error("variations upsert: " + error.message);
        }
        if (keepPrice.length > 0) {
          const { error } = await supabaseAdmin
            .from("product_variations")
            .upsert(keepPrice, { onConflict: "square_variation_id" });
          if (error) throw new Error("variations upsert (pinned price): " + error.message);
        }
        varCount = vars.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        categories: catCount,
        products: prodCount,
        variations: varCount,
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
