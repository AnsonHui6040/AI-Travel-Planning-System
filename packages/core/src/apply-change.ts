// S-01：正式行程的唯一寫入函式。依第 2.6 節批准規則選擇批准或自動套用，
// 依第 2.7 節檢查版本類型，再交給 ChangeWriter 在資料庫交易內寫入。

import { changePayload } from "@atps/schemas";
import { approvalRule } from "./approval";
import type { ChangeWriter, CommitResult, ItineraryRepository, Proposal } from "./ports";
import { classifyVersionKind } from "./versions";

export interface ApplyChangeDeps {
  writer: ChangeWriter;
  itinerary: ItineraryRepository;
}

export interface ApplyChangeInput {
  proposal: Proposal;
  // 批准的成員；自動套用類別由伺服器套用時為 null
  actorId: string | null;
}

function assertPending(proposal: Proposal) {
  if (proposal.status !== "pending") throw new Error("只有待批准的提案可以處理");
}

export async function applyChange(deps: ApplyChangeDeps, input: ApplyChangeInput): Promise<CommitResult> {
  const { proposal, actorId } = input;
  assertPending(proposal);
  const change = changePayload.parse(proposal.change);

  const rule = approvalRule(change.changeKind);
  if (rule.apply === "approval" && actorId === null) throw new Error("此類變更需成員批准");

  const items = await deps.itinerary.listItems(proposal.trip_id);
  const expected = classifyVersionKind(change.operations, items, change.structural);
  if (expected !== change.versionKind) throw new Error("提案標示的版本類型與第 2.7 節判定不符");

  if (actorId !== null) return deps.writer.approve({ proposalId: proposal.id, actorId });
  return deps.writer.autoApply({ proposalId: proposal.id });
}

export async function rejectProposal(
  deps: Pick<ApplyChangeDeps, "writer">,
  input: { proposal: Proposal; actorId: string },
): Promise<void> {
  assertPending(input.proposal);
  await deps.writer.reject({ proposalId: input.proposal.id, actorId: input.actorId });
}
