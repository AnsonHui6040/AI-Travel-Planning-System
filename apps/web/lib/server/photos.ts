import "server-only";
import { randomUUID } from "node:crypto";
import { uuid } from "@atps/schemas";
import type { PhotoInput } from "../photo-display";
import type { PhotoActionDeps } from "./photos-core";
import { createSupabaseServerClient, createSupabaseServiceClient, supabaseGuardDeps } from "./supabase";

// T21：照片。讀取一律以使用者 session（Storage 與資料表的 RLS 限成員）；
// 上傳檔案以 service role 寫入（使用者沒有 Storage 寫入權，必須經伺服器移除 EXIF），紀錄以 session 寫入
export const PHOTO_BUCKET = "trip-photos";

export async function photoActionDeps(): Promise<PhotoActionDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    memberRole: async (tripId) => {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) return null;
      const { data } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
      const role = data?.role as string | undefined;
      return role === "owner" || role === "companion" || role === "viewer" ? role : null;
    },
    itemInTrip: async (tripId, itemId) => {
      const { data } = await session.from("itinerary_items").select("id").eq("id", itemId).eq("trip_id", tripId).maybeSingle();
      return data !== null;
    },
    newId: () => randomUUID(),
    storage: {
      upload: async (path, bytes, mime) => {
        const { error } = await createSupabaseServiceClient().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        if (error) throw new Error("上傳失敗");
      },
      remove: async (path) => {
        await createSupabaseServiceClient().storage.from(PHOTO_BUCKET).remove([path]);
      },
    },
    insertPhoto: async (row) => {
      const { error } = await session.from("photos").insert(row);
      if (error) throw new Error("儲存照片紀錄失敗");
    },
  };
}

export type ItemPhotosView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripId: string;
      itemId: string;
      canUpload: boolean;
      item: { name_zh: string; name_local: string | null; address: string | null };
      photos: PhotoInput[];
    };

export async function loadItemPhotos(tripId: string, itemId: string): Promise<ItemPhotosView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(itemId).success) return { state: "not_found" };

  const { data: item } = await session
    .from("itinerary_items")
    .select("name_zh, name_local, address")
    .eq("id", itemId)
    .eq("trip_id", tripId)
    .maybeSingle();
  if (!item) return { state: "not_found" };

  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  const { data: rows, error } = await session
    .from("photos")
    .select("id, source, license, author, source_url, storage_path")
    .eq("item_id", itemId)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("讀取照片失敗");

  return {
    state: "ok",
    tripId,
    itemId,
    canUpload: member?.role === "owner" || member?.role === "companion",
    item: { name_zh: String(item.name_zh), name_local: (item.name_local as string | null) ?? null, address: (item.address as string | null) ?? null },
    photos: (rows ?? []).map((r) => ({
      // 由同源的 route handler 讀取（CSP img-src 只允許 self）
      url: `/api/photos/${String(r.storage_path)}`,
      source: r.source === "wikimedia_commons" ? "wikimedia_commons" : "user_upload",
      license: String(r.license),
      author: String(r.author),
      source_url: (r.source_url as string | null) ?? null,
    })),
  };
}

const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

// 以使用者 session 下載；Storage 的 RLS 只允許該行程成員讀取
export async function downloadPhoto(path: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!PATH.test(path)) return null;
  const session = await createSupabaseServerClient();
  const { data, error } = await session.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1) as keyof typeof TYPES;
  return { bytes: await data.arrayBuffer(), contentType: TYPES[ext] };
}
