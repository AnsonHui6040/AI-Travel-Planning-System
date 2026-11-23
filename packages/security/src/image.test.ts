import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, containsLocationMetadata, sanitizeImage } from "./index";
import { jpegWithGps, pngWithGps, webpWithGps } from "./testing/image-fixtures";

// T21、S-09：上傳照片移除 EXIF（含 GPS），限制檔案類型與大小
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("containsLocationMetadata", () => {
  it.each([
    ["JPEG", jpegWithGps()],
    ["PNG", pngWithGps()],
    ["WebP", webpWithGps()],
  ])("偵測 %s 內的 EXIF 與 XMP", (_name, image) => {
    expect(containsLocationMetadata(image)).toBe(true);
  });
});

describe("sanitizeImage", () => {
  it("JPEG：移除 APP1（EXIF、XMP）與註解，保留影像資料", () => {
    const result = sanitizeImage(jpegWithGps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe("image/jpeg");
    expect(containsLocationMetadata(result.bytes)).toBe(false);
    const out = text(result.bytes);
    expect(out).not.toContain("Exif");
    expect(out).not.toContain("GPSLatitude");
    expect(out).not.toContain("35.71");
    expect(out).toContain("JFIF");
    expect(Array.from(result.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(result.bytes.slice(-2))).toEqual([0xff, 0xd9]);
    // 影像資料完整保留
    expect(out).toContain(text(new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56])));
  });

  it("PNG：移除 eXIf 與文字區塊，保留影像區塊", () => {
    const result = sanitizeImage(pngWithGps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe("image/png");
    expect(containsLocationMetadata(result.bytes)).toBe(false);
    const out = text(result.bytes);
    expect(out).not.toContain("eXIf");
    expect(out).not.toContain("tEXt");
    expect(out).toContain("IHDR");
    expect(out).toContain("IDAT");
    expect(out).toContain("IEND");
  });

  it("WebP：移除 EXIF 與 XMP 區塊，更新旗標與檔案長度", () => {
    const result = sanitizeImage(webpWithGps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe("image/webp");
    expect(containsLocationMetadata(result.bytes)).toBe(false);
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(result.bytes.length - 8);
    // VP8X 旗標的 EXIF、XMP 位元已清除
    expect((result.bytes[20] ?? 0) & 0x0c).toBe(0);
    expect(text(result.bytes)).toContain("VP8L");
  });

  it.each([
    ["GIF", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])],
    ["SVG", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")],
    ["HTML 偽裝", new TextEncoder().encode("<html><body>not an image</body></html>")],
    ["空檔案", new Uint8Array()],
  ])("不支援的檔案類型（%s）被拒", (_name, data) => {
    expect(sanitizeImage(data)).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("超過大小上限被拒", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(sanitizeImage(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it.each([
    ["JPEG 區段長度超出檔案", new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x00])],
    ["JPEG 沒有影像資料", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ["PNG 區塊長度超出檔案", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x7f, 0, 0, 0, 0x49, 0x48, 0x44, 0x52])],
  ])("結構損壞的檔案被拒（%s）", (_name, data) => {
    expect(sanitizeImage(data)).toEqual({ ok: false, reason: "corrupt" });
  });
});
