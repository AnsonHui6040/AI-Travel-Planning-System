// S-05：判斷 DNS 解析結果是否為公開位址。無法解析的字串一律視為不公開

type Cidr = readonly [base: readonly number[], prefix: number];

// 私有、迴路、鏈路本地、共用、文件、基準測試、多播與保留範圍
const BLOCKED_V4: readonly Cidr[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

function inCidr(bytes: readonly number[], [base, prefix]: Cidr): boolean {
  for (let bit = 0; bit < prefix; bit++) {
    const i = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if (((bytes[i] ?? 0) & mask) !== ((base[i] ?? 0) & mask)) return false;
  }
  return true;
}

export function parseIPv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // 只接受十進位，不接受前導零（避免八進位解讀差異）
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

export function parseIPv6(text: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;
  let head = text;
  const tail: number[] = [];
  // 結尾可內嵌 IPv4
  const lastColon = head.lastIndexOf(":");
  if (head.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(head.slice(lastColon + 1));
    if (!v4) return null;
    tail.push(...v4);
    head = head.slice(0, lastColon + 1) + "0:0";
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...right];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function isPublicV4(bytes: readonly number[]): boolean {
  return !BLOCKED_V4.some((cidr) => inCidr(bytes, cidr));
}

function isPublicV6(bytes: readonly number[]): boolean {
  // ::ffff:0:0/96（IPv4 對應位址）：依內嵌的 IPv4 判斷
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicV4(bytes.slice(12));
  // 只允許全球單播 2000::/3；其餘（::、::1、fc00::/7、fe80::/10、ff00::/8、64:ff9b::/96、100::/64 等）一律拒絕
  if (!inCidr(bytes, [[0x20], 3])) return false;
  // 2001::/23：Teredo 與 IETF 協定位址
  if (inCidr(bytes, [[0x20, 0x01, 0x00], 23])) return false;
  // 2001:db8::/32、3fff::/20：文件用
  if (inCidr(bytes, [[0x20, 0x01, 0x0d, 0xb8], 32]) || inCidr(bytes, [[0x3f, 0xff, 0x00], 20])) return false;
  // 2002::/16（6to4）：依內嵌的 IPv4 判斷
  if (inCidr(bytes, [[0x20, 0x02], 16])) return isPublicV4(bytes.slice(2, 6));
  return true;
}

export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isPublicV6(v6);
  return false;
}

export function isIpLiteral(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return parseIPv4(bare) !== null || parseIPv6(bare) !== null;
}
