import { containsLocationMetadata, imageFixtures } from "@atps/security";
import { describe, expect, it } from "vitest";
import { uploadPhotoAction, type PhotoActionDeps } from "./photos-core";

// T21：照片上傳 Server Action（S-09、D14）。上傳前移除 EXIF；Commons 照片授權欄位缺漏時拒絕儲存
const TRIP = "b1000000-0000-4000-8000-000000000001";
const ITEM = "b1000000-0000-4000-8000-0000000000e1";
const USER = "00000000-0000-4000-8000-0000000000f7";
const PHOTO_ID = "b1000000-0000-4000-8000-0000000000a1";

function setup(overrides: Partial<PhotoActionDeps> = {}) {
  const uploads: Array<{ path: string; bytes: Uint8Array; mime: string }> = [];
  const removed: string[] = [];
  const rows: unknown[] = [];
  const deps: PhotoActionDeps = {
    getUser: async () => ({ id: USER }),
    checkRateLimit: async () => true,
    memberRole: async () => "owner",
    itemInTrip: async () => true,
    newId: () => PHOTO_ID,
    storage: {
      upload: async (path, bytes, mime) => void uploads.push({ path, bytes, mime }),
      remove: async (path) => void removed.push(path),
    },
    insertPhoto: async (row) => void rows.push(row),
    ...overrides,
  };
  return { deps, uploads, removed, rows };
}

function form(entries: Record<string, string>, file?: Uint8Array): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  if (file) f.set("file", new File([file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer], "photo.jpg", { type: "image/jpeg" }));
  return f;
}

const base = { tripId: TRIP, itemId: ITEM, source: "user_upload" };

describe("uploadPhotoAction", () => {
  it("使用者上傳：移除 EXIF 後才上傳，路徑在行程資料夾", async () => {
    const s = setup();
    const result = await uploadPhotoAction(s.deps, form({ ...base, author: "小明" }, imageFixtures.jpegWithGps()));
    expect(result).toEqual({ ok: true, message: "已上傳照片" });
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads[0]?.path).toBe(`${TRIP}/${PHOTO_ID}.jpg`);
    expect(s.uploads[0]?.mime).toBe("image/jpeg");
    expect(containsLocationMetadata(s.uploads[0]?.bytes ?? new Uint8Array())).toBe(false);
    expect(s.rows).toEqual([
      { trip_id: TRIP, item_id: ITEM, source: "user_upload", license: "本人拍攝", author: "小明", source_url: null, storage_path: `${TRIP}/${PHOTO_ID}.jpg`, uploaded_by: USER },
    ]);
  });

  it("PNG 與 WebP 依實際格式決定副檔名，不看上傳時宣告的類型", async () => {
    const s = setup();
    await uploadPhotoAction(s.deps, form(base, imageFixtures.pngWithGps()));
    expect(s.uploads[0]?.path.endsWith(".png")).toBe(true);
    expect(s.uploads[0]?.mime).toBe("image/png");
  });

  it("Commons 照片附授權、作者、來源", async () => {
    const s = setup();
    const result = await uploadPhotoAction(
      s.deps,
      form(
        { ...base, source: "wikimedia_commons", license: "CC BY-SA 4.0", author: "Example Author", sourceUrl: "https://commons.wikimedia.org/wiki/File:Sensoji.jpg" },
        imageFixtures.jpegWithGps(),
      ),
    );
    expect(result.ok).toBe(true);
    expect(s.rows[0]).toMatchObject({ source: "wikimedia_commons", license: "CC BY-SA 4.0", author: "Example Author", source_url: "https://commons.wikimedia.org/wiki/File:Sensoji.jpg" });
  });

  it.each([
    [{ license: "", author: "A", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg" }, "授權"],
    [{ license: "CC BY 4.0", author: "", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg" }, "作者"],
    [{ license: "CC BY 4.0", author: "A", sourceUrl: "" }, "來源"],
  ])("Commons 照片授權欄位缺漏時拒絕儲存，不上傳：%j", async (meta, field) => {
    const s = setup();
    const result = await uploadPhotoAction(s.deps, form({ ...base, source: "wikimedia_commons", ...meta }, imageFixtures.jpegWithGps()));
    expect(result.ok).toBe(false);
    expect(result.message).toContain(field);
    expect(s.uploads).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it.each([
    ["SVG", new TextEncoder().encode("<svg><script>alert(1)</script></svg>"), "只接受 JPEG、PNG、WebP"],
    ["損壞的 JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "檔案損壞"],
  ])("不合格的檔案（%s）不上傳", async (_name, bytes, message) => {
    const s = setup();
    expect(await uploadPhotoAction(s.deps, form(base, bytes))).toEqual({ ok: false, message });
    expect(s.uploads).toEqual([]);
  });

  it("沒有檔案時拒絕", async () => {
    const s = setup();
    expect(await uploadPhotoAction(s.deps, form(base))).toEqual({ ok: false, message: "請選擇照片" });
  });

  it.each([
    [{ memberRole: async () => "viewer" as const }, "沒有上傳權限"],
    [{ memberRole: async () => null }, "沒有上傳權限"],
    [{ itemInTrip: async () => false }, "找不到這個項目"],
    [{ getUser: async () => null }, "需要登入"],
    [{ checkRateLimit: async () => false }, "操作過於頻繁，請稍後再試"],
  ])("權限與狀態檢查不通過時不上傳", async (overrides, message) => {
    const s = setup(overrides);
    expect(await uploadPhotoAction(s.deps, form(base, imageFixtures.jpegWithGps()))).toEqual({ ok: false, message });
    expect(s.uploads).toEqual([]);
  });

  it("寫入紀錄失敗時刪除已上傳的檔案", async () => {
    const s = setup({
      insertPhoto: async () => {
        throw new Error("rls");
      },
    });
    const result = await uploadPhotoAction(s.deps, form(base, imageFixtures.jpegWithGps()));
    expect(result).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
    expect(s.removed).toEqual([`${TRIP}/${PHOTO_ID}.jpg`]);
  });

  it("行程或項目編號格式不合時拒絕", async () => {
    const s = setup();
    expect(await uploadPhotoAction(s.deps, form({ ...base, tripId: "../x" }, imageFixtures.jpegWithGps()))).toEqual({ ok: false, message: "找不到這個項目" });
  });
});
