import { applyChange, formatVersion, rejectProposal, type ApplyChangeDeps, type Proposal } from "@atps/core";
import { uuid } from "@atps/schemas";

// T34：共同批准（SH-04–SH-06）。批准與否決的成員取自 session，不接受表單傳入。
// 批准經 core 的 applyChange（第 2.6 節批准規則、第 2.7 節版本類型）與資料庫函式 approve_proposal：
// 先到先得，批准時正式行程版本已變更即失效；套用、否決、失效都經 Realtime 通知所有成員。

export interface ProposalsDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  // 以使用者 session 讀取（RLS：只有成員看得到）
  loadProposal: (proposalId: string) => Promise<Proposal | null>;
  // Owner、Companion
  canDecide: (tripId: string) => Promise<boolean>;
  applyDeps: ApplyChangeDeps;
  logError: (message: string) => void;
}

export interface ProposalActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "proposals.decide", limit: 30, windowSeconds: 60 } as const;

async function prepare(deps: ProposalsDeps, idRaw: unknown): Promise<{ proposal: Proposal; actorId: string } | ProposalActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  const id = uuid.safeParse(idRaw);
  if (!id.success) return { ok: false, message: "提案不正確" };
  const proposal = await deps.loadProposal(id.data);
  if (!proposal) return { ok: false, message: "找不到這個提案" };
  if (!(await deps.canDecide(proposal.trip_id))) return { ok: false, message: "只有 Owner 與 Companion 可以批准或否決提案" };
  if (proposal.status !== "pending") return { ok: false, message: "這個提案已經處理過" };
  return { proposal, actorId: user.id };
}

export async function approveProposalAction(deps: ProposalsDeps, idRaw: unknown): Promise<ProposalActionResult> {
  const ready = await prepare(deps, idRaw);
  if ("ok" in ready) return ready;
  try {
    const result = await applyChange(deps.applyDeps, ready);
    if (result.outcome === "invalidated") return { ok: false, message: "行程已有其他更新，這個提案已失效。請以最新版本重新提出" };
    return { ok: true, message: `已套用，Change Log 版本 ${formatVersion(result.version)}` };
  } catch {
    deps.logError("批准提案失敗");
    return { ok: false, message: "批准失敗，請稍後再試" };
  }
}

export async function rejectProposalAction(deps: ProposalsDeps, idRaw: unknown): Promise<ProposalActionResult> {
  const ready = await prepare(deps, idRaw);
  if ("ok" in ready) return ready;
  try {
    await rejectProposal({ writer: deps.applyDeps.writer }, ready);
    return { ok: true, message: "已否決" };
  } catch {
    deps.logError("否決提案失敗");
    return { ok: false, message: "否決失敗，請稍後再試" };
  }
}
