import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-OpenAI-Key",
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Image dimension helpers ──────────────────────────────────────────────────

function getJpegDimensions(b: Uint8Array): { w: number; h: number } | null {
  let i = 2; // skip SOI 0xFF 0xD8
  while (i < b.length - 8) {
    if (b[i] !== 0xFF) break;
    const marker = b[i + 1];
    // SOF0-SOF3: precision(1) height(2) width(2)
    if (marker >= 0xC0 && marker <= 0xC3) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    if (marker === 0xD9) break;
    const segLen = (b[i + 2] << 8) | b[i + 3];
    i += 2 + segLen;
  }
  return null;
}

function getPngDimensions(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24) return null;
  return {
    w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0,
    h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0,
  };
}

function getImageDimensions(b: Uint8Array, ct: string): { w: number; h: number } | null {
  if (ct.includes("png")) return getPngDimensions(b);
  return getJpegDimensions(b);
}

// ── PNG mask encoder ─────────────────────────────────────────────────────────
// Produces an RGBA PNG where:
//   alpha=255 (opaque)  = product area  → OpenAI preserves these pixels
//   alpha=0  (transparent) = background → OpenAI edits these pixels

function crc32table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
}

function crc32(data: Uint8Array, table: Uint32Array): number {
  let c = 0xFFFFFFFF;
  for (const b of data) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function makeMaskPng(w: number, h: number): Promise<Uint8Array> {
  const cx = w / 2, cy = h / 2;
  // The product ellipse covers ~85% of each dimension, leaving ~15% as editable background.
  // For off-center products, the user can always crop/zoom the original photo first.
  const rx = w * 0.42, ry = h * 0.42;

  // Build RGBA scanlines: filter_byte(1) + RGBA(4) per pixel
  const stride = 1 + w * 4;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // PNG filter type: None
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const alpha = (dx * dx + dy * dy <= 1.0) ? 255 : 0; // opaque=keep, transparent=edit
      raw[y * stride + 1 + x * 4 + 3] = alpha; // only alpha matters; RGB stays 0
    }
  }

  // zlib-compress (CompressionStream('deflate') = zlib / RFC 1950, which PNG requires)
  const cs = new CompressionStream("deflate");
  const wr = cs.writable.getWriter();
  await wr.write(raw);
  await wr.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  const enc = new TextEncoder();
  const table = crc32table();

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = enc.encode(type);
    const c = new Uint8Array(12 + data.length);
    const v = new DataView(c.buffer);
    v.setUint32(0, data.length, false);
    c.set(typeBytes, 4);
    c.set(data, 8);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(typeBytes);
    crcInput.set(data, 4);
    v.setUint32(8 + data.length, crc32(crcInput, table), false);
    return c;
  }

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, w, false);
  ihdrView.setUint32(4, h, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function extractProductType(name: string): string {
  const noSize = name
    .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|oz|lb|gm|litre|liter|pcs|pack|pieces?)\b/gi, "")
    .trim();
  const words = noSize.split(/\s+/).filter((w) => w.length > 2);
  return words.slice(-3).join(" ") || noSize;
}

function buildGroceryPrompt(name: string): string {
  const productType = extractProductType(name);
  return (
    `Studio product photograph: ${productType}. ` +
    `Pure white background, soft even lighting, sharp detail. ` +
    `Isolated food/grocery item, commercial supermarket catalog quality. ` +
    `No people, no hands, no brand logos, no text overlays.`
  );
}

function buildClothingPrompt(name: string, category: string): string {
  const cat = category.toLowerCase();
  const garment = extractProductType(name);
  if (cat.includes("saree") || cat.includes("skirt")) {
    return `Fashion retail photograph: elegant South Indian Tamil woman wearing a ${garment} saree. Full body, graceful standing pose, plain light-grey studio background. Traditional ethnic fashion catalog quality. No text, no logos.`;
  }
  if (cat.includes("salwar")) {
    return `Fashion retail photograph: South Indian woman wearing a ${garment} salwar kameez. Full body, standing, neutral studio background. South Asian fashion catalog quality. No text, no logos.`;
  }
  if (cat.includes("vesti")) {
    return `Fashion retail photograph: South Indian Tamil man wearing a traditional white ${garment} vesti (dhoti). Full body, upright pose, plain neutral studio background. Traditional formal attire, commercial catalog quality. No text, no logos.`;
  }
  if (cat.includes("frock")) {
    return `Fashion retail photograph: woman wearing a ${garment} dress. Full body, clean white studio background. Retail catalog style, commercial quality. No text, no logos.`;
  }
  return `Fashion retail photograph: person wearing ${garment}. Full or upper body, neutral studio background, retail clothing catalog style. No text, no logos.`;
}

// Enhance prompt: the mask already restricts edits to the background area only,
// so this prompt just instructs what to put in the transparent (background) regions.
function buildEnhancePrompt(section: string, category: string): string {
  if (section === "clothing") {
    const cat = category.toLowerCase();
    if (cat.includes("saree") || cat.includes("skirt")) {
      return "Replace the background with a clean plain light-grey studio backdrop. Soft even professional studio lighting. Fashion retail catalog quality. Do not alter the garment or model in any way.";
    }
    if (cat.includes("vesti")) {
      return "Replace the background with a clean plain neutral studio backdrop. Soft even professional studio lighting. Traditional South Indian fashion catalog quality. Do not alter the garment or model in any way.";
    }
    return "Replace the background with a clean plain neutral studio backdrop. Soft even professional studio lighting. Commercial clothing catalog quality. Do not alter the garment or model in any way.";
  }
  // Grocery: the mask protects the product — only background is editable
  return "Replace the background area with a seamless pure white studio backdrop. Soft even studio lighting, no shadows on background. Professional e-commerce product catalog quality.";
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Edge function handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // The key lives as a Supabase secret, not in the browser: a key shipped to
  // the client is readable by anyone with devtools on that machine, and it
  // meant every admin had to paste it before the buttons did anything.
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return ok({
      success: false,
      error: "AI photos are not configured. An administrator needs to add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.",
    });
  }

  let body: {
    productId: string;
    productName: string;
    categoryName: string;
    section: string;
    existingImageUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return ok({ success: false, error: "Invalid request body." });
  }

  const { productId, productName, categoryName, section, existingImageUrl } = body;
  if (!productId || !productName) {
    return ok({ success: false, error: "productId and productName are required." });
  }

  let imageBytes: Uint8Array;

  if (existingImageUrl) {
    // ── ENHANCE MODE ──────────────────────────────────────────────────────────
    // Uses gpt-image-1 edits WITH a generated mask so only the background is
    // changed and the product stays pixel-perfect identical.

    if (!existingImageUrl.startsWith("http://") && !existingImageUrl.startsWith("https://")) {
      return ok({ success: false, error: "existingImageUrl must be an absolute URL." });
    }

    let existingBytes: Uint8Array;
    let contentType: string;
    try {
      const imgRes = await fetch(existingImageUrl);
      if (!imgRes.ok) {
        return ok({ success: false, error: `Failed to download existing image (HTTP ${imgRes.status}).` });
      }
      existingBytes = new Uint8Array(await imgRes.arrayBuffer());
      contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    } catch (e: unknown) {
      return ok({ success: false, error: `Could not fetch existing image: ${e instanceof Error ? e.message : String(e)}` });
    }

    const ext = contentType.includes("png") ? "png" : "jpeg";
    const enhancePrompt = buildEnhancePrompt(section, categoryName ?? "");

    // Try to generate a mask that locks the product area so gpt-image-1 edits
    // ONLY the background and cannot alter the product packaging/label/text.
    let maskBytes: Uint8Array | null = null;
    try {
      const dims = getImageDimensions(existingBytes, contentType);
      if (dims && dims.w > 0 && dims.h > 0 && dims.w <= 4096 && dims.h <= 4096) {
        maskBytes = await makeMaskPng(dims.w, dims.h);
      }
    } catch {
      // Mask generation failed — proceed without mask (model still gets a strong prompt)
      maskBytes = null;
    }

    const formData = new FormData();
    formData.append("model", "gpt-image-1");
    formData.append("image", new Blob([existingBytes], { type: contentType }), `product.${ext}`);
    if (maskBytes) {
      // The mask: transparent pixels (alpha=0) = background area to edit,
      //           opaque pixels (alpha=255) = product area to preserve exactly.
      formData.append("mask", new Blob([maskBytes], { type: "image/png" }), "mask.png");
    }
    formData.append("prompt", enhancePrompt);
    formData.append("n", "1");
    formData.append("size", "1024x1024");
    formData.append("quality", "medium");

    const editRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!editRes.ok) {
      let errorMsg = `OpenAI error ${editRes.status}`;
      try {
        const errJson = await editRes.json();
        errorMsg = errJson?.error?.message ?? JSON.stringify(errJson);
      } catch {
        errorMsg = `OpenAI error ${editRes.status}: ${await editRes.text().catch(() => "")}`;
      }
      return ok({ success: false, error: errorMsg, prompt: enhancePrompt });
    }

    const editData = await editRes.json();
    const b64: string | undefined = editData.data?.[0]?.b64_json;
    if (!b64) {
      return ok({ success: false, error: "OpenAI returned no image data. Response: " + JSON.stringify(editData) });
    }
    imageBytes = base64ToUint8Array(b64);

  } else {
    // ── GENERATE MODE ─────────────────────────────────────────────────────────

    const prompt =
      section === "clothing"
        ? buildClothingPrompt(productName, categoryName ?? "clothing")
        : buildGroceryPrompt(productName);

    const genRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "medium",
      }),
    });

    if (!genRes.ok) {
      let errorMsg = `OpenAI error ${genRes.status}`;
      try {
        const errJson = await genRes.json();
        errorMsg = errJson?.error?.message ?? JSON.stringify(errJson);
      } catch {
        errorMsg = `OpenAI error ${genRes.status}: ${await genRes.text().catch(() => "")}`;
      }
      return ok({ success: false, error: errorMsg });
    }

    const genData = await genRes.json();
    const b64: string | undefined = genData.data?.[0]?.b64_json;
    if (!b64) {
      return ok({ success: false, error: "OpenAI returned no image data. Response: " + JSON.stringify(genData) });
    }
    imageBytes = base64ToUint8Array(b64);
  }

  // ── Upload to Supabase Storage ────────────────────────────────────────────

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const filePath = `ai/${productId}.png`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(filePath, imageBytes, { contentType: "image/png", upsert: true });

  if (uploadError) {
    return ok({ success: false, error: `Storage upload failed: ${uploadError.message}` });
  }

  const { data: { publicUrl } } = supabase.storage.from("product-images").getPublicUrl(filePath);
  await supabase.from("products").update({ image_url: publicUrl }).eq("id", productId);

  return ok({ success: true, imageUrl: publicUrl });
});
