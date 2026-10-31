import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { resizeImage } from "./resize";

export type Style = { slug: string; name: string; tagline: string; swatches: string[]; sort_order: number };
export type Room = { id: string; user_id: string; title: string; room_type: string; original_path: string; created_at: string };
export type PaletteColor = { role: string; name: string; hex: string };
export type Tips = { keep?: string[]; change_first?: { item: string; why: string; cost: string }[] };
export type Makeover = {
  id: string;
  room_id: string;
  user_id: string;
  style: string;
  refresh_level: "light" | "full";
  status: "generating" | "done" | "failed";
  error: string | null;
  image_path: string | null;
  palette: PaletteColor[] | null;
  tips: Tips | null;
  is_saved: boolean;
  created_at: string;
};

const BUCKET = "rooms";
const MAX_BYTES = 10 * 1024 * 1024;

function fail(e: { message: string } | null): asserts e is null {
  if (e) throw new Error(e.message);
}

// ---------- styles ----------
export async function fetchStyles(): Promise<Style[]> {
  const { data, error } = await supabase.from("styles").select("slug,name,tagline,swatches,sort_order").order("sort_order");
  fail(error);
  return data as Style[];
}

// ---------- rooms ----------
export async function listRooms(): Promise<Room[]> {
  const { data, error } = await supabase.from("rooms").select("*").order("created_at", { ascending: false });
  fail(error);
  return data as Room[];
}

export async function getRoom(id: string): Promise<Room | null> {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", id).maybeSingle();
  fail(error);
  return data as Room | null;
}

export async function uploadRoom(file: File, userId: string): Promise<Room> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Please choose a JPG, PNG or WebP photo.");
  if (file.size > MAX_BYTES) throw new Error("That photo is over 10 MB. Please choose a smaller one.");
  const blob = await resizeImage(file);
  const id = crypto.randomUUID();
  const path = `${userId}/originals/${id}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
  fail(up.error);
  const { data, error } = await supabase.from("rooms").insert({ id, original_path: path }).select().single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]); // don't leave an orphan file
    throw new Error(error.message);
  }
  return data as Room;
}

export async function renameRoom(id: string, title: string) {
  const { error } = await supabase.from("rooms").update({ title: title.trim() || "Living room" }).eq("id", id);
  fail(error);
}

export async function deleteRoom(room: Room) {
  // Deleting rows does not delete files, so remove the photo + its makeover images first.
  const { data: mks } = await supabase.from("makeovers").select("image_path").eq("room_id", room.id);
  const paths = [room.original_path, ...((mks ?? []) as { image_path: string | null }[]).map((m) => m.image_path).filter((p): p is string => !!p)];
  await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from("rooms").delete().eq("id", room.id);
  fail(error);
}

// ---------- makeovers ----------
export async function getMakeover(id: string): Promise<Makeover | null> {
  const { data, error } = await supabase.from("makeovers").select("*").eq("id", id).maybeSingle();
  fail(error);
  return data as Makeover | null;
}

export async function listGallery(): Promise<Makeover[]> {
  const { data, error } = await supabase
    .from("makeovers")
    .select("*")
    .eq("is_saved", true)
    .eq("status", "done")
    .order("created_at", { ascending: false });
  fail(error);
  return data as Makeover[];
}

export async function setSaved(id: string, saved: boolean) {
  const { error } = await supabase.from("makeovers").update({ is_saved: saved }).eq("id", id);
  fail(error);
}

export async function deleteMakeover(m: Makeover) {
  if (m.image_path) await supabase.storage.from(BUCKET).remove([m.image_path]);
  const { error } = await supabase.from("makeovers").delete().eq("id", m.id);
  fail(error);
}

export class GenerateError extends Error {
  constructor(message: string, public code?: string, public makeover?: Makeover) {
    super(message);
  }
}

export async function generateMakeover(roomId: string, style: string, refresh: "light" | "full"): Promise<Makeover> {
  const { data, error } = await supabase.functions.invoke("generate-makeover", {
    body: { room_id: roomId, style, refresh_level: refresh },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new GenerateError(body?.error ?? "Generation failed. Please try again.", body?.code, body?.makeover);
    }
    throw new GenerateError(
      /fetch|network|relay/i.test(error.message)
        ? "Couldn't reach the makeover service. Check your connection and try again."
        : error.message,
    );
  }
  return (data as { makeover: Makeover }).makeover;
}

export async function generationsLeft(): Promise<number | null> {
  const { data, error } = await supabase.rpc("my_generations_left");
  return error ? null : (data as number);
}

// ---------- images ----------
const urlCache = new Map<string, { url: string; exp: number }>();

export async function signedUrl(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  fail(error);
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = paths.filter((p) => {
    const hit = urlCache.get(p);
    if (hit && hit.exp > Date.now()) {
      out[p] = hit.url;
      return false;
    }
    return true;
  });
  if (missing.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(missing, 3600);
    fail(error);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl) {
        out[d.path] = d.signedUrl;
        urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
      }
    }
  }
  return out;
}

export const styleName = (styles: Style[], slug: string) => styles.find((s) => s.slug === slug)?.name ?? slug;
