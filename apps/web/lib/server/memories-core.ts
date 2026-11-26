import type { PostTripReport } from "@atps/core";
import { CONSTRAINT_CATALOG, identityViolation, postTripMemoryProposals, type MemoryProposalDraft } from "@atps/memory";
import { uuid } from "@atps/schemas";
import { z } from "zod";

// T41：記憶管理的 Server Action 邏輯（第 5 節）。
// MEM-03：只有本人手動新增、修改、刪除（RLS own_all），以及本人批准的旅後提案；AI 不經這裡寫入。
// MEM-07：身分與聯絡資料不寫入（資料庫 trigger 再檢查一次）。決策 0009：清單內的限制以清單的單位保存並檢查數值格式。

export class MemoryStoreError extends Error {
  constructor(readonly reason: "forbidden" | "state" | "invalid" | "unknown") {
    super(`記憶寫入失敗（${reason}）`);
  }
}

export interface MemorySave {
  id: string | null;
  layer: "personal" | "planning_rules" | "trip_context";
  kind: "constraint" | "preference";
  item: string;
  value: string;
  unit: string | null;
  tripId: string | null;
}

export interface MemoryDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  isTripMember: (tripId: string) => Promise<boolean>;
  save: (row: MemorySave) => Promise<void>;
  remove: (id: string) => Promise<void>;
  decide: (proposalId: string, approve: boolean) => Promise<void>;
  loadPostTrip: (tripId: string) => Promise<{ tripStatus: string; report: PostTripReport } | null>;
  createProposals: (tripId: string, drafts: MemoryProposalDraft[]) => Promise<number>;
  logError: (message: string) => void;
}

export interface MemoryActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "memory.write", limit: 30, windowSeconds: 60 } as const;
const blankToNull = (v: unknown) => (v === "" || v === undefined || v === null ? null : v);
const form = z.object({
  id: z.preprocess(blankToNull, uuid.nullable()),
  layer: z.enum(["personal", "planning_rules", "trip_context"]),
  kind: z.enum(["constraint", "preference"]),
  item: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(200),
  unit: z.preprocess(blankToNull, z.string().trim().min(1).max(20).nullable()),
  tripId: z.preprocess(blankToNull, uuid.nullable()),
});

async function guard(deps: MemoryDeps): Promise<MemoryActionResult | null> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  return null;
}

function storeMessage(error: unknown, deps: MemoryDeps, fallback: string): MemoryActionResult {
  if (error instanceof MemoryStoreError && error.reason === "invalid") return { ok: false, message: "身分與聯絡資料不寫入記憶" };
  if (error instanceof MemoryStoreError && error.reason === "forbidden") return { ok: false, message: "只能修改自己的記憶" };
  if (error instanceof MemoryStoreError && error.reason === "state") return { ok: false, message: "這個提案已經決定" };
  deps.logError("記憶寫入失敗");
  return { ok: false, message: fallback };
}

// 決策 0009：清單內的限制檢查格式並統一單位
function normalize(f: z.infer<typeof form>): { unit: string | null } | string {
  const entry = f.kind === "constraint" ? CONSTRAINT_CATALOG.find((e) => e.item === f.item) : undefined;
  if (!entry) return { unit: f.unit };
  if (entry.conservative === "min") {
    if (!/^\d+(\.\d+)?$/.test(f.value)) return `「${f.item}」須填數字`;
    if (entry.unit) return { unit: entry.unit };
    if (!f.unit || !/^[A-Z]{3}$/.test(f.unit)) return `「${f.item}」須填幣別（例如 JPY）`;
    return { unit: f.unit };
  }
  if (entry.conservative === "latest" || entry.conservative === "earliest") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.value)) return `「${f.item}」須填 HH:MM`;
    return { unit: null };
  }
  return { unit: null };
}

export async function saveMemoryAction(deps: MemoryDeps, fields: Record<string, unknown>): Promise<MemoryActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const parsed = form.safeParse(fields);
  if (!parsed.success) return { ok: false, message: "參數不正確" };
  const f = parsed.data;
  if ((f.layer === "trip_context") !== (f.tripId !== null)) return { ok: false, message: "參數不正確" };
  const identity = identityViolation(f.item, f.value) ?? (f.unit ? identityViolation(f.unit, f.unit) : null);
  if (identity) return { ok: false, message: identity };
  const normalized = normalize(f);
  if (typeof normalized === "string") return { ok: false, message: normalized };
  if (f.tripId && !(await deps.isTripMember(f.tripId))) return { ok: false, message: "找不到這個行程，或你不是成員。" };
  try {
    await deps.save({ id: f.id, layer: f.layer, kind: f.kind, item: f.item, value: f.value, unit: normalized.unit, tripId: f.tripId });
  } catch (error) {
    return storeMessage(error, deps, "儲存失敗，請稍後再試");
  }
  return { ok: true, message: "已儲存" };
}

export async function deleteMemoryAction(deps: MemoryDeps, idRaw: unknown): Promise<MemoryActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const id = uuid.safeParse(idRaw);
  if (!id.success) return { ok: false, message: "參數不正確" };
  try {
    await deps.remove(id.data);
  } catch (error) {
    return storeMessage(error, deps, "刪除失敗，請稍後再試");
  }
  return { ok: true, message: "已刪除" };
}

export async function decideProposalAction(deps: MemoryDeps, idRaw: unknown, decisionRaw: unknown): Promise<MemoryActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const id = uuid.safeParse(idRaw);
  if (!id.success || (decisionRaw !== "approve" && decisionRaw !== "reject")) return { ok: false, message: "參數不正確" };
  const approve = decisionRaw === "approve";
  try {
    await deps.decide(id.data, approve);
  } catch (error) {
    return storeMessage(error, deps, "操作失敗，請稍後再試");
  }
  return { ok: true, message: approve ? "已批准，寫入記憶" : "已否決" };
}

export async function generateProposalsAction(deps: MemoryDeps, tripIdRaw: unknown): Promise<MemoryActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return { ok: false, message: "參數不正確" };
  const loaded = await deps.loadPostTrip(tripId.data);
  if (!loaded) return { ok: false, message: "找不到這個行程，或你不是成員。" };
  if (loaded.tripStatus !== "ended" && loaded.tripStatus !== "archived") return { ok: false, message: "行程結束後才能產生旅後記憶提案" };
  const drafts = postTripMemoryProposals(loaded.report);
  if (drafts.length === 0) return { ok: false, message: "這趟旅行沒有足以提出的差異" };
  let count: number;
  try {
    count = await deps.createProposals(tripId.data, drafts);
  } catch (error) {
    if (error instanceof MemoryStoreError && error.reason === "forbidden") return { ok: false, message: "找不到這個行程，或你不是成員。" };
    if (error instanceof MemoryStoreError && error.reason === "state") return { ok: false, message: "行程結束後才能產生旅後記憶提案" };
    deps.logError("旅後記憶提案建立失敗");
    return { ok: false, message: "建立失敗，請稍後再試" };
  }
  return { ok: true, message: `已建立 ${count} 個旅後記憶提案，請到「記憶」批准或否決` };
}
