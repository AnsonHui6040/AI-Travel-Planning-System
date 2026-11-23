// T21、S-09：上傳照片移除 EXIF（含 GPS）與其他中繼資料，限制檔案類型與大小。
// 不解碼影像，只依檔案結構保留影像所需的區段（allowlist），其餘全部移除；結構不完整的檔案拒絕。
// 只接受 JPEG、PNG、WebP；SVG、GIF、HTML 等一律拒絕。

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export type SanitizeResult = { ok: true; bytes: Uint8Array; mime: ImageMime } | { ok: false; reason: "unsupported_type" | "too_large" | "corrupt" };

class Corrupt extends Error {}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const at = (b: Uint8Array, i: number): number => {
  const v = b[i];
  if (v === undefined) throw new Corrupt();
  return v;
};
const be16 = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1);
const be32 = (b: Uint8Array, i: number) => ((at(b, i) << 24) | (at(b, i + 1) << 16) | (at(b, i + 2) << 8) | at(b, i + 3)) >>> 0;
const le32 = (b: Uint8Array, i: number) => (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16) | (at(b, i + 3) << 24)) >>> 0;
const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(at(b, i), at(b, i + 1), at(b, i + 2), at(b, i + 3));
const startsWith = (b: Uint8Array, sig: readonly number[]) => sig.every((v, i) => b[i] === v);

const JPEG_SIG = [0xff, 0xd8, 0xff] as const;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

// JPEG：保留 APP0（JFIF）與影像必要區段；移除 APP1–APP15（EXIF、XMP、ICC 等）與 COM；EOI 之後的資料捨棄
function sanitizeJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let sawScan = false;
  while (i < b.length) {
    if (at(b, i) !== 0xff) throw new Corrupt();
    while (at(b, i) === 0xff && at(b, i + 1) === 0xff) i++;
    const marker = at(b, i + 1);
    if (marker === 0xd9) {
      if (!sawScan) throw new Corrupt();
      out.push(b.subarray(i, i + 2));
      return concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = be16(b, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > b.length) throw new Corrupt();
    const dropped = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!dropped) out.push(b.subarray(i, end));
    i = end;
    if (marker === 0xda) {
      sawScan = true;
      // 熵編碼資料：遇到 FF 後接 00 或 RST 為資料；其他標記為下一個區段
      const start = i;
      while (i < b.length) {
        if (at(b, i) === 0xff) {
          const next = at(b, i + 1);
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            i += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        i++;
      }
      out.push(b.subarray(start, i));
    }
  }
  throw new Corrupt();
}

// PNG：只保留影像所需與色彩相關的區塊；移除 eXIf、tEXt、zTXt、iTXt、tIME 等
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "pHYs", "bKGD", "sBIT", "acTL", "fcTL", "fdAT"]);

function sanitizePng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i < b.length) {
    const length = be32(b, i);
    const type = fourcc(b, i + 4);
    const end = i + 12 + length;
    if (end > b.length) throw new Corrupt();
    if (first && type !== "IHDR") throw new Corrupt();
    first = false;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(out);
  }
  throw new Corrupt();
}

// WebP：只保留影像區塊；移除 EXIF、XMP，並清除 VP8X 的對應旗標、重算 RIFF 長度
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

function sanitizeWebp(b: Uint8Array): Uint8Array {
  const riffSize = le32(b, 4);
  if (riffSize + 8 > b.length || riffSize < 4) throw new Corrupt();
  const limit = 8 + riffSize;
  const chunks: Uint8Array[] = [];
  let i = 12;
  let hasImage = false;
  while (i < limit) {
    const type = fourcc(b, i);
    const size = le32(b, i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > limit) throw new Corrupt();
    if (WEBP_KEEP.has(type)) {
      const chunk = b.slice(i, end);
      if (type === "VP8X") chunk[8] = at(chunk, 8) & ~0x0c;
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") hasImage = true;
      chunks.push(chunk);
    }
    i = end;
  }
  if (!hasImage) throw new Corrupt();
  const body = concat([new Uint8Array([0x57, 0x45, 0x42, 0x50]), ...chunks]);
  const header = new Uint8Array(8);
  header.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat([header, body]);
}

function detect(b: Uint8Array): ImageMime | null {
  if (startsWith(b, JPEG_SIG)) return "image/jpeg";
  if (startsWith(b, PNG_SIG)) return "image/png";
  if (b.length >= 12 && fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "WEBP") return "image/webp";
  return null;
}

export function sanitizeImage(input: Uint8Array): SanitizeResult {
  const mime = detect(input);
  if (!mime) return { ok: false, reason: "unsupported_type" };
  if (input.length > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  try {
    const bytes = mime === "image/jpeg" ? sanitizeJpeg(input) : mime === "image/png" ? sanitizePng(input) : sanitizeWebp(input);
    return { ok: true, bytes, mime };
  } catch (error) {
    if (error instanceof Corrupt) return { ok: false, reason: "corrupt" };
    throw error;
  }
}

// 檢查用：是否含有 EXIF 或 XMP 的特徵字串（驗證移除結果）
const SIGNATURES = ["Exif\u0000", "<x:xmpmeta", "ns.adobe.com/xap", "eXIf", "tEXt", "iTXt", "zTXt", "GPS"];

export function containsLocationMetadata(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes);
  return SIGNATURES.some((s) => text.includes(s)) || /EXIF.{4}(MM|II)/s.test(text);
}
