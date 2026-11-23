import { describe, expect, it } from "vitest";
import { photoDisplay } from "./photo-display";

// T21、D14：有照片時顯示照片與來源標示；沒有照片時顯示當地名稱與地址
const item = { name_zh: "淺草寺", name_local: "浅草寺", address: "東京都台東区浅草2-3-1" };

describe("photoDisplay", () => {
  it("沒有照片時顯示當地名稱與地址", () => {
    expect(photoDisplay(item, [])).toEqual({ kind: "fallback", title: "浅草寺", lines: ["東京都台東区浅草2-3-1"] });
  });

  it("沒有當地名稱時改用中文名稱；沒有地址時只顯示名稱", () => {
    expect(photoDisplay({ ...item, name_local: null, address: null }, [])).toEqual({ kind: "fallback", title: "淺草寺", lines: [] });
  });

  it("使用者上傳的照片標示拍攝者", () => {
    const view = photoDisplay(item, [{ url: "https://x.supabase.co/a.jpg", source: "user_upload", license: "本人拍攝", author: "小明", source_url: null }]);
    expect(view).toEqual({
      kind: "photos",
      photos: [{ url: "https://x.supabase.co/a.jpg", alt: "淺草寺", credit: "照片：小明", sourceUrl: null }],
    });
  });

  it("Commons 照片標示作者、授權與來源連結", () => {
    const view = photoDisplay(item, [
      { url: "https://x.supabase.co/b.jpg", source: "wikimedia_commons", license: "CC BY-SA 4.0", author: "Example", source_url: "https://commons.wikimedia.org/wiki/File:S.jpg" },
    ]);
    expect(view).toMatchObject({ kind: "photos", photos: [{ credit: "照片：Example（CC BY-SA 4.0，Wikimedia Commons）", sourceUrl: "https://commons.wikimedia.org/wiki/File:S.jpg" }] });
  });

  it("沒有取得網址的照片不顯示；全部沒有網址時改顯示名稱與地址", () => {
    expect(photoDisplay(item, [{ url: null, source: "user_upload", license: "本人拍攝", author: "小明", source_url: null }])).toMatchObject({ kind: "fallback" });
  });
});
