"use server";

import { revalidatePath } from "next/cache";
import { approveProposalAction, rejectProposalAction, type ProposalActionResult } from "../../../../lib/server/proposals-core";
import { proposalsActionDeps } from "../../../../lib/server/proposals";

// T34：批准與否決。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 proposals-core 內檢查（C-11）

export async function approveProposal(_previous: ProposalActionResult | null, form: FormData): Promise<ProposalActionResult> {
  const result = await approveProposalAction(await proposalsActionDeps(), form.get("proposalId"));
  const tripId = form.get("tripId");
  if (typeof tripId === "string") {
    // 行程內所有畫面（含 T38 Incident Mode 的即時分支與分頁的待批准數）
    revalidatePath(`/trips/${tripId}`, "layout");
  }
  return result;
}

export async function rejectProposal(_previous: ProposalActionResult | null, form: FormData): Promise<ProposalActionResult> {
  const result = await rejectProposalAction(await proposalsActionDeps(), form.get("proposalId"));
  const tripId = form.get("tripId");
  if (typeof tripId === "string") {
    revalidatePath(`/trips/${tripId}`, "layout");
  }
  return result;
}
