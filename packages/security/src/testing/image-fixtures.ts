// 測試用合成圖片位元組：只需結構正確，不需可解碼。含 GPS 的 EXIF 區段用來確認會被移除。

const bytes = (...parts: (number[] | Uint8Array)[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

// TIFF（big-endian）：IFD0 只有一個 GPS IFD 指標（tag 0x8825），GPS IFD 有緯度參考 N
export const EXIF_WITH_GPS = bytes(
  ascii("Exif"),
  [0, 0],
  ascii("MM"),
  [0x00, 0x2a],
  be32(8),
  be16(1),
  [0x88, 0x25, 0x00, 0x04],
  be32(1),
  be32(26),
  be32(0),
  be16(1),
  [0x00, 0x01, 0x00, 0x02],
  be32(2),
  ascii("N"),
  [0],
  be32(0),
);

const segment = (marker: number, payload: number[] | Uint8Array) => bytes([0xff, marker], be16(payload.length + 2), payload);

export function jpegWithGps(): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    segment(0xe0, bytes(ascii("JFIF"), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    segment(0xe1, EXIF_WITH_GPS),
    segment(0xe1, bytes(ascii("http://ns.adobe.com/xap/1.0/"), [0], ascii("<x:xmpmeta>GPSLatitude</x:xmpmeta>"))),
    segment(0xfe, ascii("拍攝於 35.71,139.79")),
    segment(0xdb, new Uint8Array(65)),
    segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56],
    [0xff, 0xd9],
  );
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const pngChunk = (type: string, data: number[] | Uint8Array) => {
  const typed = bytes(ascii(type), data);
  return bytes(be32(data.length), typed, be32(crc32(typed)));
};

export function pngWithGps(): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...be32(1), ...be32(1), 8, 2, 0, 0, 0]),
    pngChunk("eXIf", EXIF_WITH_GPS.slice(6)),
    pngChunk("tEXt", bytes(ascii("Comment"), [0], ascii("GPS 35.71,139.79"))),
    pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
    pngChunk("IEND", []),
  );
}

const riffChunk = (type: string, data: number[] | Uint8Array) => {
  const pad = data.length % 2 === 1 ? [0] : [];
  return bytes(ascii(type), le32(data.length), data, pad);
};

export function webpWithGps(): Uint8Array {
  // VP8X 旗標：EXIF（0x08）與 XMP（0x04）
  const vp8x = riffChunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const vp8l = riffChunk("VP8L", [0x2f, 0, 0, 0, 0]);
  const exif = riffChunk("EXIF", EXIF_WITH_GPS.slice(6));
  const xmp = riffChunk("XMP ", ascii("<x:xmpmeta>GPSLatitude</x:xmpmeta>"));
  const body = bytes(ascii("WEBP"), vp8x, vp8l, exif, xmp);
  return bytes(ascii("RIFF"), le32(body.length), body);
}
