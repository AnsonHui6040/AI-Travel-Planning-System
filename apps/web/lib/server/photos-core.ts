import { parseCommonsAttribution, uuid } from "@atps/schemas";
import { sanitizeImage, type ImageMime } from "@atps/security";

// T21：照片上傳 Server Action 邏輯（S-09、D14）。
// 1. 登入、速率限制、角色（Owner、Companion 可上傳，第 6 節）、項目屬於該行程
// 2. 伺服器移除 EXIF 與其他中繼資料，依實際格式決定類型；不合格的檔案不上傳
// 3. 以 service role 上傳到行程資料夾（使用者沒有 Storage 寫入權），再以使用者 session 寫入紀錄（受 RLS 限制）
// 4. 紀錄寫入失敗時刪除已上傳的檔案

export interface PhotoActionDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  memberRole: (tripId: string) => Promise<"owner" | "companion" | "viewer" | null>;
  itemInTrip: (tripId: string, itemId: string) => Promise<boolean>;
  newId: () => string;
  storage: {
    upload: (path: string, bytes: Uint8Array, mime: ImageMime) => Promise<void>;
    remove: (path: string) => Promise<void>;
  };
  insertPhoto: (row: {
    trip_id: string;
    item_id: string;
    source: "user_upload" | "wikimedia_commons";
    license: string;
    author: string;
    source_url: string | null;
    storage_path: string;
    uploaded_by: string;
  }) => Promise<void>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "photos.upload", limit: 20, windowSeconds: 60 } as const;
const EXTENSIONS: Record<ImageMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const REJECT_MESSAGES = {
  unsupported_type: "只接受 JPEG、PNG、WebP",
  too_large: "照片超過 5 MB，請壓縮後再上傳",
  corrupt: "檔案損壞",
} as const;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

export async function uploadPhotoAction(deps: PhotoActionDeps, form: FormData): Promise<ActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) {
    return { ok: false, message: "操作過於頻繁，請稍後再試" };
  }

  const tripId = text(form, "tripId");
  const itemId = text(form, "itemId");
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(itemId).success) return { ok: false, message: "找不到這個項目" };
  const role = await deps.memberRole(tripId);
  if (role !== "owner" && role !== "companion") return { ok: false, message: "沒有上傳權限" };
  if (!(await deps.itemInTrip(tripId, itemId))) return { ok: false, message: "找不到這個項目" };

  const source = text(form, "source") === "wikimedia_commons" ? "wikimedia_commons" : "user_upload";
  let license = "本人拍攝";
  let author = text(form, "author").trim() || "本人";
  let sourceUrl: string | null = null;
  if (source === "wikimedia_commons") {
    const parsed = parseCommonsAttribution({ license: text(form, "license"), author: text(form, "author"), sourceUrl: text(form, "sourceUrl") });
    if (!parsed.ok) return { ok: false, message: parsed.error };
    ({ license, author } = parsed.value);
    sourceUrl = parsed.value.sourceUrl;
  } else if ([...author].length > 200) {
    return { ok: false, message: "拍攝者最多 200 字" };
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, message: "請選擇照片" };
  const sanitized = sanitizeImage(new Uint8Array(await file.arrayBuffer()));
  if (!sanitized.ok) return { ok: false, message: REJECT_MESSAGES[sanitized.reason] };

  const path = `${tripId}/${deps.newId()}.${EXTENSIONS[sanitized.mime]}`;
  try {
    await deps.storage.upload(path, sanitized.bytes, sanitized.mime);
  } catch {
    return { ok: false, message: "上傳失敗，請稍後再試" };
  }
  try {
    await deps.insertPhoto({ trip_id: tripId, item_id: itemId, source, license, author, source_url: sourceUrl, storage_path: path, uploaded_by: user.id });
  } catch {
    await deps.storage.remove(path).catch(() => undefined);
    return { ok: false, message: "儲存失敗，請稍後再試" };
  }
  return { ok: true, message: "已上傳照片" };
}
