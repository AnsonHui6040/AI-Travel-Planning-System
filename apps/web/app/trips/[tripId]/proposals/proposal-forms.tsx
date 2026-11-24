"use client";

import { useActionState } from "react";
import { approveProposal, rejectProposal } from "./actions";

// T34：批准、否決。只送出提案編號；批准者由伺服器取自 session

// 處理後仍保留同一個元件（隱藏按鈕），才能顯示結果訊息
export function ProposalDecision({
  tripId,
  proposalId,
  pending,
}: {
  tripId: string;
  proposalId: string;
  pending: boolean;
}) {
  const [approved, approve, approving] = useActionState(approveProposal, null);
  const [rejected, reject, rejecting] = useActionState(rejectProposal, null);
  const state = approved ?? rejected;
  if (!pending && !state) return null;
  return (
    <div className="proposal-decision">
      {pending ? (
        <>
          <form action={approve}>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="proposalId" value={proposalId} />
            <button type="submit" disabled={approving || rejecting}>
              批准
            </button>
          </form>
          <form action={reject}>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="proposalId" value={proposalId} />
            <button type="submit" disabled={approving || rejecting}>
              否決
            </button>
          </form>
        </>
      ) : null}
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
