// ReRoom · generate-makeover edge function
// Browser calls: supabase.functions.invoke('generate-makeover', { body: { room_id, style, refresh_level } })
//
// Secrets needed (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY        required — from aistudio.google.com
//   GEMINI_IMAGE_MODEL    optional — default "gemini-2.5-flash-image" (Nano Banana)
//   GEMINI_TEXT_MODEL     optional — default "gemini-2.5-flash" (palette + tips)
//   DAILY_LIMIT           optional — default 15
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function decodeBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_BASE = Deno.env.get("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta/models";
const IMAGE_TIMEOUT_MS = 100_000;
const TEXT_TIMEOUT_MS = 60_000;

const REFRESH_RULES: Record<string, string> = {
  light:
    "Only change wall colour, curtains, rugs, cushions, throws, lighting and small decor. Keep every existing piece of furniture in the same place and shape.",
  full:
    "You may replace furniture, flooring, lighting and decor to fit the style, but keep the room's architecture unchanged.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Gemini calls ----------

type Part = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

async function callGemini(model: string, body: unknown, timeoutMs: number) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("Server is missing GEMINI_API_KEY.");
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) throw new Error(`AI quota reached (${msg}). Check billing/limits in Google AI Studio.`);
    throw new Error(`AI request failed: ${msg}`);
  }
  const parts: Part[] = data?.candidates?.[0]?.content?.parts ?? [];
  if (!parts.length) {
    const reason = data?.promptFeedback?.blockReason ?? data?.candidates?.[0]?.finishReason ?? "no content";
    throw new Error(`AI returned no result (${reason}).`);
  }
  return parts;
}

async function generateImage(photoB64: string, photoMime: string, prompt: string) {
  const model = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image";
  const parts = await callGemini(
    model,
    {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: photoMime, data: photoB64 } }, { text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    },
    IMAGE_TIMEOUT_MS,
  );
  for (const p of parts) {
    const inline = p.inlineData ?? (p.inline_data && { mimeType: p.inline_data.mime_type, data: p.inline_data.data });
    if (inline?.data) return { bytes: decodeBase64(inline.data), mime: inline.mimeType || "image/png" };
  }
  const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
  throw new Error(`AI did not return an image${text ? `: ${text}` : "."}`);
}

type Plan = {
  is_living_room: boolean;
  palette: { role: string; name: string; hex: string }[];
  keep: string[];
  change_first: { item: string; why: string; cost: string }[];
};

async function generatePlan(photoB64: string, photoMime: string, styleName: string, refresh: string): Promise<Plan> {
  const model = Deno.env.get("GEMINI_TEXT_MODEL") || "gemini-2.5-flash";
  const budget = refresh === "light" ? "light refresh (paint and textiles, keep the furniture)" : "full makeover";
  const prompt = `You are an interior designer. Look at this photo. The owner wants a ${styleName} look for their living room with a ${budget} budget.

Return JSON only, in exactly this shape:
{
  "is_living_room": true,
  "palette": [
    {"role": "Dominant 60% · walls, large surfaces", "name": "", "hex": "#RRGGBB"},
    {"role": "Secondary 30% · furniture, curtains, rug", "name": "", "hex": "#RRGGBB"},
    {"role": "Accent 10% · cushions, art, decor", "name": "", "hex": "#RRGGBB"}
  ],
  "keep": ["items in the photo worth keeping and how to restyle them"],
  "change_first": [{"item": "", "why": "", "cost": "$ | $$ | $$$"}]
}

Rules: set "is_living_room" to false if the photo is not an indoor living room or lounge. List at most 3 "keep" items and at most 4 "change_first" items, cheapest high-impact changes first (paint and textiles before furniture). If the room looks rented, avoid permanent changes. Keep each string under 120 characters.`;

  const parts = await callGemini(
    model,
    {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: photoMime, data: photoB64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    },
    TEXT_TIMEOUT_MS,
  );
  const raw = parts.map((p) => p.text ?? "").join("").replace(/^```(json)?|```$/g, "").trim();
  const obj = JSON.parse(raw);

  const hex = (h: unknown) => (typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h) ? (h.startsWith("#") ? h : `#${h}`) : null);
  const str = (s: unknown) => (typeof s === "string" ? s.slice(0, 200) : "");
  return {
    is_living_room: obj?.is_living_room !== false,
    palette: (Array.isArray(obj?.palette) ? obj.palette : [])
      .map((c: any) => ({ role: str(c?.role), name: str(c?.name), hex: hex(c?.hex) }))
      .filter((c: any) => c.hex)
      .slice(0, 3),
    keep: (Array.isArray(obj?.keep) ? obj.keep : []).map(str).filter(Boolean).slice(0, 3),
    change_first: (Array.isArray(obj?.change_first) ? obj.change_first : [])
      .map((c: any) => ({ item: str(c?.item), why: str(c?.why), cost: str(c?.cost) }))
      .filter((c: any) => c.item)
      .slice(0, 4),
  };
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Who is calling?
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Please sign in again." }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "Please sign in again." }, 401);

  // 2. Validate input
  let body: { room_id?: string; style?: string; refresh_level?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const roomId = body.room_id ?? "";
  const refresh = body.refresh_level === "full" ? "full" : "light";
  if (!UUID_RE.test(roomId)) return json({ error: "Missing or invalid room." }, 400);

  const [{ data: room }, { data: style }] = await Promise.all([
    admin.from("rooms").select("id, user_id, original_path").eq("id", roomId).eq("user_id", user.id).maybeSingle(),
    admin.from("styles").select("slug, name, prompt_desc").eq("slug", body.style ?? "").maybeSingle(),
  ]);
  if (!room) return json({ error: "Room not found." }, 404);
  if (!style) return json({ error: "Unknown style." }, 400);

  // 3. Daily limit (counts attempts; survives deletes)
  const limit = Number(Deno.env.get("DAILY_LIMIT") ?? 15);
  const { data: allowed, error: limitErr } = await admin.rpc("claim_generation", { p_user_id: user.id, p_daily_limit: limit });
  if (limitErr) return json({ error: "Could not check your daily limit." }, 500);
  if (!allowed) return json({ error: "Daily limit reached. You've used today's makeovers; come back tomorrow.", code: "limit" }, 429);

  // 4. Create the makeover row
  const prompt = [
    `Redesign this living room photo in ${style.name} interior style: ${style.prompt_desc}`,
    "Keep the exact same room: same walls, windows, doors, ceiling, floor plan, camera angle and perspective. Keep the same framing and aspect ratio as the original photo.",
    REFRESH_RULES[refresh],
    "Photorealistic interior photograph, natural daylight, high detail. No text, no people, no watermarks.",
  ].join("\n\n");

  const { data: makeover, error: insErr } = await admin
    .from("makeovers")
    .insert({ room_id: room.id, user_id: user.id, style: style.slug, refresh_level: refresh, status: "generating", prompt })
    .select()
    .single();
  if (insErr || !makeover) return json({ error: "Could not start the makeover." }, 500);

  const fail = async (message: string, status = 502) => {
    const { data } = await admin.from("makeovers").update({ status: "failed", error: message }).eq("id", makeover.id).select().single();
    return json({ error: message, makeover: data }, status);
  };

  try {
    // 5. Get the original photo
    const { data: file, error: dlErr } = await admin.storage.from("rooms").download(room.original_path);
    if (dlErr || !file) return await fail("Could not read your photo. Try uploading it again.", 500);
    const photoMime = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const photoB64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));

    // 6. Image + palette in parallel
    const [imageRes, planRes] = await Promise.allSettled([
      generateImage(photoB64, photoMime, prompt),
      generatePlan(photoB64, photoMime, style.name, refresh),
    ]);

    if (planRes.status === "fulfilled" && !planRes.value.is_living_room) {
      return await fail("This doesn't look like a living room. Please upload a photo of your living room.", 422);
    }
    if (imageRes.status === "rejected") {
      const msg = imageRes.reason instanceof Error ? imageRes.reason.message : String(imageRes.reason);
      return await fail(msg.includes("TimeoutError") || msg.includes("timed out") ? "The AI took too long. Please try again." : msg);
    }
    if (planRes.status === "rejected") console.error("palette failed:", planRes.reason);

    // 7. Store the result image
    const ext = imageRes.value.mime.includes("jpeg") ? "jpg" : imageRes.value.mime.includes("webp") ? "webp" : "png";
    const imagePath = `${user.id}/makeovers/${makeover.id}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("rooms")
      .upload(imagePath, imageRes.value.bytes, { contentType: imageRes.value.mime, upsert: true });
    if (upErr) return await fail("Could not save the makeover image.", 500);

    // 8. Finish the row
    const plan = planRes.status === "fulfilled" ? planRes.value : null;
    const { data: done, error: updErr } = await admin
      .from("makeovers")
      .update({
        status: "done",
        image_path: imagePath,
        palette: plan?.palette?.length ? plan.palette : null,
        tips: plan ? { keep: plan.keep, change_first: plan.change_first } : null,
        error: null,
      })
      .eq("id", makeover.id)
      .select()
      .single();
    if (updErr) return await fail("Could not save the makeover.", 500);

    return json({ makeover: done });
  } catch (e) {
    console.error(e);
    return await fail(e instanceof Error ? e.message : "Something went wrong. Please try again.", 500);
  }
});
