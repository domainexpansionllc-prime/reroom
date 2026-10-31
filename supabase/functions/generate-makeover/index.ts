// ReRoom · generate-makeover edge function
// Browser calls: supabase.functions.invoke('generate-makeover', { body: { room_id, style, refresh_level } })
//
// Pipeline (architecture guardrails):
//   1. SURVEY   – vision model inventories the room's architecture (windows, doors, open archways, walls…)
//                 and rejects photos that aren't living rooms, before any image is paid for.
//   2. GENERATE – image model gets a prompt that names every architectural element that must not change,
//                 plus a strict allow-list of what MAY change (furniture, paint, flooring, curtains, decor).
//                 Palette + tips are generated in parallel.
//   3. INSPECT  – vision model compares before/after on architecture only. If something was added, removed,
//                 moved or covered, regenerate once with the specific problems called out.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY        required — from aistudio.google.com
//   GEMINI_IMAGE_MODEL    optional — default "gemini-3.1-flash-image" (Nano Banana 2).
//                         "gemini-3-pro-image" (Nano Banana Pro) keeps structure even better but costs more and is slower.
//   GEMINI_TEXT_MODEL     optional — default "gemini-3.8-flash" (survey, inspection, palette)
//   STRUCTURE_CHECK       optional — "off" to skip step 3
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
const IMAGE_MODEL = () => Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-3.1-flash-image";
const TEXT_MODEL = () => Deno.env.get("GEMINI_TEXT_MODEL") || "gemini-3.8-flash";
const IMAGE_TIMEOUT_MS = 90_000;
const TEXT_TIMEOUT_MS = 40_000;
const RETRY_IF_UNDER_MS = 70_000; // only retry when there's time left before the function's wall-clock limit

// What each refresh level may change. Architecture is never on this list.
const ALLOWED: Record<string, string> = {
  light: [
    "- wall paint colour (paint only — no new wall panelling, wallpaper murals or built-ins)",
    "- curtains, drapes or blinds, ONLY on windows that already exist",
    "- rugs, cushions, throws and other soft textiles",
    "- table and floor lamps, plants, wall art and small decorative objects",
    "Keep every existing piece of furniture exactly where it is, with the same shape and size. You may only restyle its fabric or colour.",
  ].join("\n"),
  full: [
    "- furniture: replace or restyle sofas, chairs, tables, shelving and storage, keeping a similar layout so walkways and openings stay clear",
    "- wall paint colour (paint only)",
    "- flooring material and colour (the floor stays the same size and shape)",
    "- curtains, drapes or blinds, ONLY on windows that already exist",
    "- rugs, textiles, light fixtures, lamps, plants, wall art and decor",
  ].join("\n"),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Gemini plumbing ----------

type Part = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};
type Img = { b64: string; mime: string };
const imgPart = (i: Img) => ({ inline_data: { mime_type: i.mime, data: i.b64 } });

async function callGemini(model: string, body: unknown, timeoutMs: number): Promise<Part[]> {
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

async function askJson(parts: unknown[], timeoutMs = TEXT_TIMEOUT_MS): Promise<any> {
  const out = await callGemini(
    TEXT_MODEL(),
    {
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json" },
    },
    timeoutMs,
  );
  const raw = out.map((p) => p.text ?? "").join("").replace(/^```(json)?|```$/g, "").trim();
  return JSON.parse(raw);
}

const str = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const strList = (a: unknown, n: number, max = 200) => (Array.isArray(a) ? a.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

// ---------- 1. SURVEY ----------

type Survey = {
  is_living_room: boolean;
  windows: string[];
  doors: string[];
  openings: string[];
  features: string[];
  room: string;
};

async function surveyRoom(photo: Img): Promise<Survey> {
  const prompt = `You are an architectural surveyor. Look carefully at this interior photo and list its FIXED ARCHITECTURE only (not furniture or decor). Be specific about count and position in the frame (left wall, back wall, right side, behind the sofa, etc.).

Return JSON only:
{
  "is_living_room": true,
  "windows": ["e.g. two tall rectangular windows on the left wall, side by side"],
  "doors": ["e.g. white panel door on the right wall, closed"],
  "openings": ["e.g. wide open rounded archway in the back wall leading to the dining room"],
  "features": ["e.g. brick fireplace centred on the back wall", "exposed ceiling beams", "staircase on the right"],
  "room": "one sentence on the room's shape, depth, ceiling height and the camera viewpoint"
}

Rules: "openings" means passages WITHOUT a door (archways, cased openings, pass-throughs, open plan connections) — list every one. Count windows exactly. Use [] when there are none. Set "is_living_room" to false if this is not an indoor living room, lounge or family room.`;
  const o = await askJson([imgPart(photo), { text: prompt }]);
  return {
    is_living_room: o?.is_living_room !== false,
    windows: strList(o?.windows, 8),
    doors: strList(o?.doors, 6),
    openings: strList(o?.openings, 6),
    features: strList(o?.features, 8),
    room: str(o?.room, 300),
  };
}

// ---------- 2. GENERATE ----------

function buildPrompt(styleName: string, styleDesc: string, refresh: string, s: Survey, fixes: string[] = []) {
  const list = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((i) => `  • ${i}`).join("\n")}` : `${label}: none`);
  return [
    `Edit this photograph of a living room. Restyle the interior in ${styleName} style: ${styleDesc}`,
    "",
    "FIXED ARCHITECTURE — keep every item below EXACTLY as it is in the photo. Do not add, remove, move, resize, reshape, close, fill in or cover any of them:",
    list("Windows", s.windows),
    list("Doors", s.doors),
    list("Open archways / openings (must stay fully open and see-through — never put curtains, doors, panels or walls in them)", s.openings),
    list("Other fixed features", s.features),
    `Room shape and viewpoint: ${s.room || "keep exactly as in the photo"}`,
    "Also keep identical: the position of every wall, the room's size and depth, ceiling height, and the exact camera position, lens, framing and perspective. Do not add any new windows, doors, openings or walls.",
    "",
    `YOU MAY CHANGE ONLY:\n${ALLOWED[refresh]}`,
    "",
    ...(fixes.length
      ? [`A previous attempt made these mistakes — make sure they do NOT happen:\n${fixes.map((f) => `  • ${f}`).join("\n")}`, ""]
      : []),
    "Output one photorealistic interior photograph from the identical viewpoint, natural daylight, high detail. No text, no people, no watermarks.",
  ].join("\n");
}

async function generateImage(photo: Img, prompt: string): Promise<Img & { bytes: Uint8Array }> {
  const parts = await callGemini(
    IMAGE_MODEL(),
    {
      contents: [{ role: "user", parts: [imgPart(photo), { text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    },
    IMAGE_TIMEOUT_MS,
  );
  for (const p of parts) {
    const inline = p.inlineData ?? (p.inline_data && { mimeType: p.inline_data.mime_type, data: p.inline_data.data });
    if (inline?.data) return { b64: inline.data, mime: inline.mimeType || "image/png", bytes: decodeBase64(inline.data) };
  }
  const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
  throw new Error(`AI did not return an image${text ? `: ${text}` : "."}`);
}

type Plan = {
  palette: { role: string; name: string; hex: string }[];
  keep: string[];
  change_first: { item: string; why: string; cost: string }[];
};

async function generatePlan(photo: Img, styleName: string, refresh: string): Promise<Plan> {
  const budget = refresh === "light" ? "light refresh (paint and textiles, keep the furniture)" : "full makeover (furniture, paint and flooring)";
  const prompt = `You are an interior designer. Look at this photo of a living room. The owner wants a ${styleName} look with a ${budget} budget. They cannot change the architecture (walls, windows, doors, archways).

Return JSON only, in exactly this shape:
{
  "palette": [
    {"role": "Dominant 60% · walls, large surfaces", "name": "", "hex": "#RRGGBB"},
    {"role": "Secondary 30% · furniture, curtains, rug", "name": "", "hex": "#RRGGBB"},
    {"role": "Accent 10% · cushions, art, decor", "name": "", "hex": "#RRGGBB"}
  ],
  "keep": ["items in the photo worth keeping and how to restyle them"],
  "change_first": [{"item": "", "why": "", "cost": "$ | $$ | $$$"}]
}

Rules: at most 3 "keep" items and at most 4 "change_first" items, cheapest high-impact changes first (paint and textiles before furniture). Only suggest furniture, paint, flooring, window treatments, lighting and decor — never structural changes. If the room looks rented, avoid permanent changes. Keep each string under 120 characters.`;
  const o = await askJson([imgPart(photo), { text: prompt }]);
  const hex = (h: unknown) => (typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h) ? (h.startsWith("#") ? h : `#${h}`) : null);
  return {
    palette: (Array.isArray(o?.palette) ? o.palette : [])
      .map((c: any) => ({ role: str(c?.role), name: str(c?.name), hex: hex(c?.hex) }))
      .filter((c: any) => c.hex)
      .slice(0, 3),
    keep: strList(o?.keep, 3),
    change_first: (Array.isArray(o?.change_first) ? o.change_first : [])
      .map((c: any) => ({ item: str(c?.item), why: str(c?.why), cost: str(c?.cost, 10) }))
      .filter((c: any) => c.item)
      .slice(0, 4),
  };
}

// ---------- 3. INSPECT ----------

async function inspect(before: Img, after: Img, s: Survey): Promise<{ ok: boolean; problems: string[] }> {
  const prompt = `Image 1 is the ORIGINAL living room. Image 2 is an AI redesign of the same room.
Judge ONLY the fixed architecture. Ignore furniture, paint colour, flooring, curtains on existing windows, rugs, lighting and decor — those are allowed to change.

The original was surveyed as:
- Windows: ${s.windows.join("; ") || "none"}
- Doors: ${s.doors.join("; ") || "none"}
- Open archways/openings: ${s.openings.join("; ") || "none"}
- Other fixed features: ${s.features.join("; ") || "none"}

Check: Are all windows still there (same count and position, not covered by new walls)? Are all doors there? Is every open archway/opening still open (not closed off, filled, or hidden behind curtains)? Are the walls in the same positions — is the room the same size and depth? Same ceiling? Same camera viewpoint? Were any new windows, doors or openings invented?

Return JSON only: {"same_architecture": true, "problems": ["short, specific description of each problem"]}`;
  const o = await askJson([{ text: "Image 1 (original):" }, imgPart(before), { text: "Image 2 (redesign):" }, imgPart(after), { text: prompt }]);
  return { ok: o?.same_architecture !== false, problems: strList(o?.problems, 5) };
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const started = Date.now();

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling?
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Please sign in again." }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "Please sign in again." }, 401);

  // Validate input
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

  // Daily limit (counts attempts; survives deletes)
  const limit = Number(Deno.env.get("DAILY_LIMIT") ?? 15);
  const { data: allowed, error: limitErr } = await admin.rpc("claim_generation", { p_user_id: user.id, p_daily_limit: limit });
  if (limitErr) return json({ error: "Could not check your daily limit." }, 500);
  if (!allowed) return json({ error: "Daily limit reached. You've used today's makeovers; come back tomorrow.", code: "limit" }, 429);

  const { data: makeover, error: insErr } = await admin
    .from("makeovers")
    .insert({ room_id: room.id, user_id: user.id, style: style.slug, refresh_level: refresh, status: "generating" })
    .select()
    .single();
  if (insErr || !makeover) return json({ error: "Could not start the makeover." }, 500);

  const fail = async (message: string, status = 502) => {
    const { data } = await admin.from("makeovers").update({ status: "failed", error: message }).eq("id", makeover.id).select().single();
    return json({ error: message, makeover: data }, status);
  };
  const errMsg = (e: unknown) => {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return /TimeoutError|timed out|aborted/i.test(m) ? "The AI took too long. Please try again." : (e instanceof Error ? e.message : m);
  };

  try {
    // Original photo
    const { data: file, error: dlErr } = await admin.storage.from("rooms").download(room.original_path);
    if (dlErr || !file) return await fail("Could not read your photo. Try uploading it again.", 500);
    const photo: Img = {
      mime: file.type && file.type.startsWith("image/") ? file.type : "image/jpeg",
      b64: encodeBase64(new Uint8Array(await file.arrayBuffer())),
    };

    // 1. SURVEY (also rejects non-living-rooms before paying for an image)
    let survey: Survey;
    try {
      survey = await surveyRoom(photo);
    } catch (e) {
      console.error("survey failed, continuing with generic guardrails:", e);
      survey = { is_living_room: true, windows: [], doors: [], openings: [], features: [], room: "" };
    }
    if (!survey.is_living_room) {
      return await fail("This doesn't look like a living room. Please upload a photo of your living room.", 422);
    }

    // 2. GENERATE (+ palette in parallel)
    let prompt = buildPrompt(style.name, style.prompt_desc, refresh, survey);
    const planP = generatePlan(photo, style.name, refresh).catch((e) => {
      console.error("palette failed:", e);
      return null;
    });
    let image: Img & { bytes: Uint8Array };
    try {
      image = await generateImage(photo, prompt);
    } catch (e) {
      return await fail(errMsg(e));
    }

    // 3. INSPECT → regenerate once if the architecture changed
    let inspection: { ok: boolean; problems: string[]; retried: boolean } = { ok: true, problems: [], retried: false };
    if (Deno.env.get("STRUCTURE_CHECK") !== "off") {
      try {
        const r = await inspect(photo, image, survey);
        inspection = { ...r, retried: false };
        if (!r.ok && Date.now() - started < RETRY_IF_UNDER_MS) {
          console.log("architecture changed, retrying:", r.problems);
          const retryPrompt = buildPrompt(style.name, style.prompt_desc, refresh, survey, r.problems);
          try {
            image = await generateImage(photo, retryPrompt);
            prompt = retryPrompt;
            inspection.retried = true;
          } catch (e) {
            console.error("retry failed, keeping first image:", e);
          }
        }
      } catch (e) {
        console.error("inspection failed, keeping image:", e);
      }
    }

    // Store result image
    const ext = image.mime.includes("jpeg") ? "jpg" : image.mime.includes("webp") ? "webp" : "png";
    const imagePath = `${user.id}/makeovers/${makeover.id}.${ext}`;
    const { error: upErr } = await admin.storage.from("rooms").upload(imagePath, image.bytes, { contentType: image.mime, upsert: true });
    if (upErr) return await fail("Could not save the makeover image.", 500);

    const plan = await planP;
    const { data: done, error: updErr } = await admin
      .from("makeovers")
      .update({
        status: "done",
        image_path: imagePath,
        palette: plan?.palette?.length ? plan.palette : null,
        tips: plan ? { keep: plan.keep, change_first: plan.change_first } : null,
        prompt: `${prompt}\n\n[survey] ${JSON.stringify(survey)}\n[inspection] ${JSON.stringify(inspection)}\n[ms] ${Date.now() - started}`,
        error: null,
      })
      .eq("id", makeover.id)
      .select()
      .single();
    if (updErr) return await fail("Could not save the makeover.", 500);

    return json({ makeover: done });
  } catch (e) {
    console.error(e);
    return await fail(errMsg(e), 500);
  }
});
