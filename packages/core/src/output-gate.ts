import { roleOutputs, type RoleOutputs } from "@atps/schemas";
import { approvalRule } from "./approval";
import { containsImageUrl } from "./research";
import { AI_ROLES, type AiRole } from "./ai-settings";
import { runRole, type RoleRunDeps, type RoleRunInput, type RoleRunResult } from "./role-runner";

// T18、S-01、S-03：AI 輸出寫入前的最後檢查。
// AI 只能產生候選、核實結果、交通估算或待批准提案；正式行程只由 applyChange 經成員批准寫入。
// 1. 依角色 schema 重新驗證（未知欄位一律拒絕）
// 2. 輸出含圖片網址時拒絕（S-16）
// 3. 輸出含 API key 或未開放給 AI 的敏感欄位值時拒絕（含網址編碼後的值）
// 4. Planner 的提案只能是需要批准的種類；自動套用的種類由伺服器產生，不接受 AI 提出
// 5. 只能操作行程中已知的項目

export type GateRejection = "schema" | "image_url" | "leak" | "auto_kind" | "unknown_item";

export interface GateContext {
  knownItemIds: ReadonlySet<string>;
  // 請求者的 API key 與未開啟「提供給 AI」的敏感欄位值
  forbiddenValues: readonly string[];
}

export type GateResult =
  | { [R in AiRole]: { ok: true; role: R; output: RoleOutputs[R] } }[AiRole]
  | { ok: false; reason: GateRejection; detail: string };

const MIN_FORBIDDEN_LENGTH = 2;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

function decoded(text: string): string[] {
  const forms = [text];
  try {
    const once = decodeURIComponent(text);
    if (once !== text) forms.push(once);
  } catch {
    // 不合法的編碼：只比對原文
  }
  return forms;
}

function leaks(output: unknown, forbidden: readonly string[]): boolean {
  const values = forbidden.filter((v) => v.length >= MIN_FORBIDDEN_LENGTH);
  if (values.length === 0) return false;
  return strings(output).some((s) => decoded(s).some((form) => values.some((v) => form.includes(v))));
}

const reject = (reason: GateRejection, detail: string): GateResult => ({ ok: false, reason, detail });

export function gateRoleOutput(role: AiRole, output: unknown, ctx: GateContext): GateResult {
  const parsed = roleOutputs[role].safeParse(output);
  if (!parsed.success) return reject("schema", "輸出不符角色格式");
  // S-16：照片只依 place_id 或離線照片來源取得，AI 輸出含圖片網址時整份拒絕
  if (containsImageUrl(parsed.data)) return reject("image_url", "輸出含有圖片網址");
  // 訊息不含輸出內容（S-02、S-10）
  if (leaks(parsed.data, ctx.forbiddenValues)) return reject("leak", "輸出含有不可提供的資料");

  const known = (id: string) => ctx.knownItemIds.has(id);
  switch (role) {
    case "research":
      return { ok: true, role, output: parsed.data as RoleOutputs["research"] };
    case "verification": {
      const data = parsed.data as RoleOutputs["verification"];
      if (!data.results.every((r) => known(r.item_id))) return reject("unknown_item", "核實結果指向不存在的項目");
      return { ok: true, role, output: data };
    }
    case "transport": {
      const data = parsed.data as RoleOutputs["transport"];
      if (!data.segments.every((s) => known(s.from_item_id) && known(s.to_item_id))) {
        return reject("unknown_item", "交通估算指向不存在的項目");
      }
      return { ok: true, role, output: data };
    }
    case "master_planner":
    case "live_planner": {
      const data = parsed.data as RoleOutputs["live_planner"];
      if (data.proposals.some((p) => approvalRule(p.changeKind).apply !== "approval")) {
        return reject("auto_kind", "AI 提案只能是需要批准的種類");
      }
      if (!data.proposals.every((p) => p.operations.every((o) => known(o.itemId)))) {
        return reject("unknown_item", "提案操作不存在的項目");
      }
      return { ok: true, role, output: data };
    }
  }
}

// 輸出的去處：只有新增候選、核實結果、交通估算與待批准提案，沒有批准、記憶或設定
export interface RoleOutputSink {
  addCandidates(tripId: string, candidates: RoleOutputs["research"]["candidates"]): Promise<void>;
  addVerificationResults(tripId: string, results: RoleOutputs["verification"]["results"]): Promise<void>;
  addSegments(tripId: string, segments: RoleOutputs["transport"]["segments"]): Promise<void>;
  addPendingProposals(tripId: string, baseVersion: number, proposals: RoleOutputs["live_planner"]["proposals"]): Promise<void>;
}

export interface HandleContext extends GateContext {
  tripId: string;
  baseVersion: number;
}

export type HandledRun =
  | { status: "stored"; kind: "candidates" | "verification" | "segments" | "pending_proposals"; count: number }
  | { status: "rejected"; reason: GateRejection | "output_invalid"; detail: string }
  | { status: "not_completed"; run: Exclude<RoleRunResult, { status: "completed" } | { status: "output_invalid" }> };

export async function handleRoleRun(
  deps: RoleRunDeps & { sink: RoleOutputSink },
  run: RoleRunInput,
  ctx: HandleContext,
): Promise<HandledRun> {
  const result = await runRole(deps, run);
  if (result.status === "output_invalid") return { status: "rejected", reason: "output_invalid", detail: result.reason };
  if (result.status !== "completed") return { status: "not_completed", run: result };

  // 自訂角色（registry 擴充）沒有對應的輸出去處，一律拒絕
  const role = (AI_ROLES as readonly string[]).includes(run.role.id) ? (run.role.id as AiRole) : null;
  if (role === null) return { status: "rejected", reason: "schema", detail: "不支援的角色" };
  const gated = gateRoleOutput(role, result.output, ctx);
  if (!gated.ok) return { status: "rejected", reason: gated.reason, detail: gated.detail };

  switch (gated.role) {
    case "research":
      await deps.sink.addCandidates(ctx.tripId, gated.output.candidates);
      return { status: "stored", kind: "candidates", count: gated.output.candidates.length };
    case "verification":
      await deps.sink.addVerificationResults(ctx.tripId, gated.output.results);
      return { status: "stored", kind: "verification", count: gated.output.results.length };
    case "transport":
      await deps.sink.addSegments(ctx.tripId, gated.output.segments);
      return { status: "stored", kind: "segments", count: gated.output.segments.length };
    case "master_planner":
    case "live_planner":
      await deps.sink.addPendingProposals(ctx.tripId, ctx.baseVersion, gated.output.proposals);
      return { status: "stored", kind: "pending_proposals", count: gated.output.proposals.length };
  }
}
