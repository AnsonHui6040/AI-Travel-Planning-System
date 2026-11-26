import { PROVIDER_NAMES, type AiProvider, type MemoryScope, type PostTripReport } from "@atps/core";

// T41：第 5 節記憶的純函式。
// MEM-07 合併所有成員的記憶；MEM-08 限制數值衝突取最保守值（決策 0009 的固定清單），不保留來源成員；
// MEM-07 身分與聯絡資料不寫入（與資料庫 private.identity_violation 相同規則）；MEM-11 只輸出角色記憶範圍內的部分；
// MEM-03、MEM-04 旅後提案依 Planned vs Actual 比較報告產生，擁有者批准後才寫入。

export type MemoryLayer = "personal" | "planning_rules" | "trip_context";
export type MemoryKind = "constraint" | "preference";

export interface MemoryEntry {
  layer: MemoryLayer;
  kind: MemoryKind;
  item: string;
  value: string;
  unit: string | null;
}

export interface MergedMemory extends MemoryEntry {
  conflict: boolean;
}

type Direction = "min" | "latest" | "earliest" | "union";

export interface CatalogEntry {
  item: string;
  // null：單位由使用者填寫（預算的幣別）或不需要單位
  unit: string | null;
  conservative: Direction;
}

// 決策 0009
export const CONSTRAINT_CATALOG: readonly CatalogEntry[] = [
  { item: "每日步行上限", unit: "公里", conservative: "min" },
  { item: "單次連續步行", unit: "分鐘", conservative: "min" },
  { item: "每日活動時數", unit: "小時", conservative: "min" },
  { item: "每日轉乘上限", unit: "次", conservative: "min" },
  { item: "休息間隔", unit: "分鐘", conservative: "min" },
  { item: "每日預算上限", unit: null, conservative: "min" },
  { item: "最早出發", unit: null, conservative: "latest" },
  { item: "最晚回住宿", unit: null, conservative: "earliest" },
  { item: "飲食限制", unit: null, conservative: "union" },
];

const catalog = new Map(CONSTRAINT_CATALOG.map((e) => [e.item, e]));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMBER = /^\d+(\.\d+)?$/;

function parse(direction: Direction, value: string): number | null {
  const v = value.trim();
  if (direction === "min") return NUMBER.test(v) ? Number(v) : null;
  if (direction === "latest" || direction === "earliest") {
    if (!TIME.test(v)) return null;
    const [h, m] = v.split(":").map(Number) as [number, number];
    return h * 60 + m;
  }
  return null;
}

const keyOf = (m: MemoryEntry) => `${m.layer}|${m.kind}|${m.item}|${m.value}|${m.unit ?? ""}`;
const strip = (m: MemoryEntry): MemoryEntry => ({ layer: m.layer, kind: m.kind, item: m.item, value: m.value, unit: m.unit });

export function mergeMemories(memories: readonly MemoryEntry[]): MergedMemory[] {
  const out: MergedMemory[] = [];
  const seen = new Set<string>();
  // 可比較的限制先依「項目＋單位」分組（預算依幣別分開）
  const groups = new Map<string, { entries: MemoryEntry[]; direction: Direction; index: number }>();

  for (const raw of memories) {
    const m = strip(raw);
    const entry = m.kind === "constraint" ? catalog.get(m.item) : undefined;
    const direction = entry?.conservative;
    if (direction && direction !== "union" && parse(direction, m.value) !== null) {
      const g = `${m.item}|${m.unit ?? ""}`;
      const group = groups.get(g);
      if (group) group.entries.push(m);
      else {
        groups.set(g, { entries: [m], direction, index: out.length });
        out.push({ ...m, conflict: false }); // 佔位，之後以最保守值取代
      }
      continue;
    }
    // 飲食限制、清單外的限制、偏好與無法判讀的值：全部保留，相同的只留一個
    if (seen.has(keyOf(m))) continue;
    seen.add(keyOf(m));
    out.push({ ...m, conflict: false });
  }

  for (const { entries, direction, index } of groups.values()) {
    const scored = entries.map((e) => ({ e, n: parse(direction, e.value) as number }));
    const pick = scored.reduce((best, cur) => {
      if (direction === "latest") return cur.n > best.n ? cur : best;
      return cur.n < best.n ? cur : best; // min、earliest
    });
    const conflict = new Set(scored.map((s) => s.n)).size > 1;
    // 最保守值的層級取最嚴格來源中的第一個；不保留擁有者
    out[index] = { ...pick.e, conflict };
  }
  return out;
}

// MEM-07 ------------------------------------------------------------------------
const IDENTITY_ITEM = /(姓名|名字|全名|電話|手機|電子郵件|e-?mail|信箱|地址|住址|護照|身分證|身份證|證件|聯絡)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_CHARS = /^[+0-9()\s.-]+$/;

export function identityViolation(item: string, value: string): string | null {
  if (IDENTITY_ITEM.test(item)) return "身分與聯絡資料不寫入記憶";
  if (EMAIL.test(value)) return "電子郵件不寫入記憶";
  if (PHONE_CHARS.test(value)) {
    const digits = value.replace(/\D/g, "").length;
    if (digits >= 9 || (/^\s*[+0]/.test(value) && digits >= 8)) return "電話不寫入記憶";
  }
  return null;
}

// MEM-11 ------------------------------------------------------------------------
const LAYER_NAMES: Record<MemoryLayer, string> = { personal: "個人偏好", planning_rules: "Planning Rules", trip_context: "本趟旅行" };
const KIND_NAMES: Record<MemoryKind, string> = { constraint: "限制", preference: "偏好" };

export function scopeMerged(merged: readonly MergedMemory[], scope: MemoryScope): MergedMemory[] {
  return merged.filter((m) => scope.layers.includes(m.layer) && scope.kinds.includes(m.kind));
}

// 送往 AI 時放在 member_preference 資料區塊（S-03），內容只有項目、數值與單位
export function memoryBlockContent(merged: readonly MergedMemory[], scope: MemoryScope): string {
  const lines = scopeMerged(merged, scope).map((m) => {
    const unit = m.unit ? ` ${m.unit}` : "";
    const note = m.conflict ? "（成員間有不同設定，已取最保守值）" : "";
    return `${LAYER_NAMES[m.layer]}，${KIND_NAMES[m.kind]}：${m.item}：${m.value}${unit}${note}`;
  });
  return lines.join("\n");
}

// MEM-03、MEM-04 ------------------------------------------------------------------
export interface MemoryProposalDraft extends MemoryEntry {
  reason: string;
}

const TYPE_LABELS: Record<string, string> = { attraction: "景點", restaurant: "餐飲", shopping: "購物", photography: "攝影", activity: "活動" };
const STAY_THRESHOLD = 15;
const TRANSPORT_THRESHOLD = 10;

const average = (xs: readonly number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

export function postTripMemoryProposals(report: PostTripReport): MemoryProposalDraft[] {
  const out: MemoryProposalDraft[] = [];
  const rule = (item: string, value: string, unit: string | null, reason: string) =>
    out.push({ layer: "planning_rules", kind: "preference", item, value, unit, reason });

  if (report.stayDifferences.length > 0) {
    const avg = average(report.stayDifferences.map((s) => s.diffMinutes));
    if (Math.abs(avg) >= STAY_THRESHOLD) {
      rule("停留時間調整", String(avg), "分鐘", `${report.stayDifferences.length} 個項目平均${avg > 0 ? "多" : "少"}停留 ${Math.abs(avg)} 分鐘`);
    }
  }
  if (report.transportDifferences.length > 0) {
    const avg = average(report.transportDifferences.map((t) => t.diffMinutes));
    if (avg >= TRANSPORT_THRESHOLD) rule("交通估算額外緩衝", String(avg), "分鐘", `${report.transportDifferences.length} 段移動平均比估算多 ${avg} 分鐘`);
  }
  if (report.backupsUsed.length > 0) {
    rule("Backup 實際使用", String(report.backupsUsed.length), "次", `實際用上：${report.backupsUsed.map((b) => b.name_zh).join("、")}`);
  }
  if (report.crowdedSlots.length > 0) {
    rule("每日安排密度", "減少", null, `${report.crowdedSlots.length} 個時段過密：${report.crowdedSlots.map((c) => `${c.date} ${c.from}–${c.until}`).join("、")}`);
  }
  for (const u of report.unreliableRecommendations) {
    const who = u.provider ? `${PROVIDER_NAMES[u.provider as AiProvider] ?? u.provider}（${u.model ?? "未記錄模型"}）` : "使用者新增";
    rule("不可靠的建議來源", `${who}：${u.name_zh}`.slice(0, 200), null, u.reason);
  }
  const top = report.favoriteActivityTypes[0];
  if (top) rule("喜歡的活動類型", TYPE_LABELS[top.type] ?? top.type, null, `旅後標記得分最高（${top.score} 分，${top.count} 個項目）`);
  return out.filter((p) => identityViolation(p.item, p.value) === null);
}
