import { checkBaseline, type BaselineIssue } from "@atps/core";
import { tripBaselineData, uuid, type TripBaselineData } from "@atps/schemas";

// T23：旅行基線 Server Action 邏輯。權限（Owner、Companion）與狀態由資料庫函式檢查，呼叫者取自 session；
// 格式由 schema 檢查；確認前在伺服器重新執行矛盾檢查，有矛盾時不確認（E5）。回應與 log 不含基線內容。

export class BaselineStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`基線寫入失敗（${reason}）`);
  }
}

export interface BaselineStore {
  save(tripId: string, data: TripBaselineData): Promise<void>;
  // 以使用者 session 讀取（受 RLS 限制）
  load(tripId: string): Promise<{ data: unknown; confirmedAt: string | null } | null>;
  confirm(tripId: string): Promise<void>;
}

export interface BaselineDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  store: BaselineStore;
  logError: (message: string) => void;
}

export interface BaselineActionResult {
  ok: boolean;
  message: string;
  issues?: BaselineIssue[];
}

const RATE = { endpoint: "baseline.write", limit: 30, windowSeconds: 60 } as const;
const MAX_JSON_LENGTH = 65_536;

const conflictsOf = (issues: readonly BaselineIssue[]) => issues.filter((i) => i.severity === "conflict").length;

async function guard(deps: BaselineDeps, tripId: unknown): Promise<BaselineActionResult | string> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  if (typeof tripId !== "string" || !uuid.safeParse(tripId).success) return { ok: false, message: "行程不正確" };
  return tripId;
}

function storeFailure(deps: BaselineDeps, error: unknown, log: string): BaselineActionResult {
  if (error instanceof BaselineStoreError) {
    if (error.reason === "forbidden") return { ok: false, message: "沒有編輯基線的權限" };
    if (error.reason === "state") return { ok: false, message: "基線已確認，之後的修改請提出變更提案" };
    if (error.reason === "invalid") return { ok: false, message: "基線資料格式不正確" };
  }
  deps.logError(log);
  return { ok: false, message: log === "儲存基線失敗" ? "儲存失敗，請稍後再試" : "確認失敗，請稍後再試" };
}

export async function saveBaselineAction(deps: BaselineDeps, tripIdRaw: unknown, json: unknown): Promise<BaselineActionResult> {
  const tripId = await guard(deps, tripIdRaw);
  if (typeof tripId !== "string") return tripId;
  if (typeof json !== "string" || json.length > MAX_JSON_LENGTH) return { ok: false, message: "基線資料格式不正確" };
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, message: "基線資料格式不正確" };
  }
  const parsed = tripBaselineData.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `（${first.path.join(".")}）` : "";
    return { ok: false, message: `基線資料格式不正確${where}：${first?.message ?? ""}` };
  }
  try {
    await deps.store.save(tripId, parsed.data);
  } catch (error) {
    return storeFailure(deps, error, "儲存基線失敗");
  }
  const issues = checkBaseline(parsed.data);
  const conflicts = conflictsOf(issues);
  return { ok: true, message: conflicts > 0 ? `已儲存基線草稿，有 ${conflicts} 個矛盾需要處理` : "已儲存基線草稿", issues };
}

export async function confirmBaselineAction(deps: BaselineDeps, tripIdRaw: unknown): Promise<BaselineActionResult> {
  const tripId = await guard(deps, tripIdRaw);
  if (typeof tripId !== "string") return tripId;
  let stored: Awaited<ReturnType<BaselineStore["load"]>>;
  try {
    stored = await deps.store.load(tripId);
  } catch (error) {
    return storeFailure(deps, error, "確認基線失敗");
  }
  if (!stored) return { ok: false, message: "請先儲存基線" };
  if (stored.confirmedAt !== null) return { ok: false, message: "Trip Baseline v1 已確認" };
  const parsed = tripBaselineData.safeParse(stored.data);
  if (!parsed.success) return { ok: false, message: "基線資料格式不正確，請重新儲存" };
  const issues = checkBaseline(parsed.data);
  const conflicts = conflictsOf(issues);
  if (conflicts > 0) return { ok: false, message: `有 ${conflicts} 個矛盾，處理後才能確認`, issues };
  try {
    await deps.store.confirm(tripId);
  } catch (error) {
    return storeFailure(deps, error, "確認基線失敗");
  }
  return { ok: true, message: "已確認 Trip Baseline v1，行程進入規劃中", issues };
}
