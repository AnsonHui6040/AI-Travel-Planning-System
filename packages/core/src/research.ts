import type { RoleOutputs, TripBaselineData } from "@atps/schemas";
import type { AiProvider } from "./ai-settings";

// T24：多 AI 獨立研究。Research A–D 平行執行，彼此不讀對方結論，只寫入 Candidate List（S-03、S-16）。

export type ResearchTrackId = "A" | "B" | "C" | "D";
export type ResearchCandidate = RoleOutputs["research"]["candidates"][number];

export interface ResearchTrack {
  id: ResearchTrackId;
  label: string;
  focus: string;
}

export const RESEARCH_TRACKS: readonly ResearchTrack[] = [
  { id: "A", label: "Research A", focus: "主要景點與官方資訊（開放時間、門票、預約、官方公告）" },
  { id: "B", label: "Research B", focus: "餐飲、咖啡與購物（營業時段、公休日、是否需要訂位）" },
  { id: "C", label: "Research C", focus: "攝影、日出日落、夜景與季節活動（最佳時段、天氣依賴）" },
  { id: "D", label: "Research D", focus: "冷門替代（人潮較少、可取代熱門景點的地點）" },
];

export const RESEARCH_TRACK_IDS: readonly ResearchTrackId[] = RESEARCH_TRACKS.map((t) => t.id);

export interface ResearchContext {
  trip: { name: string; destination: string | null };
  baseline: TripBaselineData;
}

// 結構與 @atps/security 的 DataBlock 相容；由伺服器以 composeRoleInput 組成最終輸入
export interface ResearchInput {
  task: string;
  blocks: { kind: "trip"; content: string }[];
}

function track(id: ResearchTrackId): ResearchTrack {
  const found = RESEARCH_TRACKS.find((t) => t.id === id);
  if (!found) throw new Error("未知的研究方向");
  return found;
}

// 只取行程與基線的指定欄位，逐一列出：多傳入的資料（例如其他方向的候選）不會被帶入
export function researchTrackInput(id: ResearchTrackId, context: ResearchContext): ResearchInput {
  const t = track(id);
  const b = context.baseline;
  const data = {
    行程: context.trip.name,
    目的地: context.trip.destination,
    日期: { 開始: b.start_date, 結束: b.end_date, 時區: b.timezone },
    住宿: b.lodgings.map((l) => ({ 地區: l.area, 入住: l.check_in, 退房: l.check_out })),
    固定活動: b.fixed_activities.map((a) => ({ 名稱: a.name, 地區: a.area, 日期: a.date, 開始: a.start, 結束: a.end })),
    同行人數: b.companions,
    體力限制: b.stamina_note,
    預算: b.budget,
    必去地點: b.must_visit,
    排除地點: b.excluded,
    交通偏好: b.transport_preferences,
    攝影需求: b.photography_needs,
  };
  return {
    task: `${t.label}：依旅行基線研究「${t.focus}」的候選地點。只輸出候選，每個候選附來源網址、取得時間與資料日期；不輸出圖片網址；排除地點不要列入。`,
    blocks: [{ kind: "trip", content: JSON.stringify(data, null, 2) }],
  };
}

// ---- S-16：AI 輸出不得包含圖片網址 ------------------------------------------

const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|avif|svg|heic|heif|bmp|tiff?|ico)$/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'）)\]]+/gi;

function isImageHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (/^lh\d+\.googleusercontent\.com$/.test(host)) return true;
  if (host === "upload.wikimedia.org" || host === "i.imgur.com") return true;
  if (host === "places.googleapis.com" && /\/photos\//.test(url.pathname)) return true;
  if (host === "maps.googleapis.com" && url.pathname.startsWith("/maps/api/place/photo")) return true;
  return false;
}

function textHasImageUrl(text: string): boolean {
  if (/data:image\//i.test(text)) return true;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (isImageHost(url) || IMAGE_EXTENSION.test(url.pathname)) return true;
  }
  return false;
}

export function containsImageUrl(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof value === "string") return textHasImageUrl(value);
  if (Array.isArray(value)) return value.some((v) => containsImageUrl(v, depth + 1));
  if (typeof value === "object" && value !== null) return Object.values(value).some((v) => containsImageUrl(v, depth + 1));
  return false;
}

// ---- S-16：place_id 由伺服器解析 --------------------------------------------

export type PlaceResolution =
  | { status: "resolved"; placeId: string }
  | { status: "unresolved"; reason: "not_found" | "name_mismatch" | "too_far" };

export type PlaceResolver = (query: { name: string; area: string }) => Promise<PlaceResolution>;

export interface CandidateRow {
  name_zh: string;
  name_local: string | null;
  area: string;
  type: ResearchCandidate["type"];
  recommendation_reason: string;
  suggested_stay_minutes: number;
  constraint_note: string | null;
  sources: ResearchCandidate["sources"];
  // T25：Research 提出的事實主張，記錄提出的模型，供交叉核查
  fact_claims: (ResearchCandidate["facts"][number] & { by: { provider: AiProvider; model: string } })[];
  data_date: string;
  generated_by: { provider: AiProvider; model: string };
  place_id: string | null;
  // 研究不是核實：一律 Unverified，由 Verification（T25）更新
  verification_status: "unverified";
  research_track: ResearchTrackId;
  place_resolution: "resolved" | "not_found" | "name_mismatch" | "too_far" | "error" | "no_key";
}

export async function toCandidateRows(
  candidates: readonly ResearchCandidate[],
  id: ResearchTrackId,
  generatedBy: { provider: AiProvider; model: string },
  resolve: PlaceResolver | null,
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = [];
  for (const c of candidates) {
    let placeId: string | null = null;
    let resolution: CandidateRow["place_resolution"] = "no_key";
    if (resolve) {
      try {
        const result = await resolve({ name: c.name_local ?? c.name_zh, area: c.area });
        if (result.status === "resolved") {
          placeId = result.placeId;
          resolution = "resolved";
        } else {
          resolution = result.reason;
        }
      } catch {
        resolution = "error";
      }
    }
    rows.push({
      name_zh: c.name_zh,
      name_local: c.name_local,
      area: c.area,
      type: c.type,
      recommendation_reason: c.recommendation_reason,
      suggested_stay_minutes: c.suggested_stay_minutes,
      constraint_note: c.constraints,
      sources: c.sources,
      fact_claims: c.facts.map((f) => ({ ...f, by: generatedBy })),
      data_date: c.data_date,
      generated_by: generatedBy,
      place_id: placeId,
      verification_status: "unverified",
      research_track: id,
      place_resolution: resolution,
    });
  }
  return rows;
}
