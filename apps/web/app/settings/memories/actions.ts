"use server";

import { revalidatePath } from "next/cache";
import {
  decideProposalAction,
  deleteMemoryAction,
  generateProposalsAction,
  saveMemoryAction,
  type MemoryActionResult,
} from "../../../lib/server/memories-core";
import { memoryDeps } from "../../../lib/server/memories";

// T41：記憶。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 memories-core 內檢查（C-11）

const FIELDS = ["id", "layer", "kind", "item", "value", "unit", "tripId"] as const;

function refresh(tripId: unknown) {
  revalidatePath("/settings/memories");
  if (typeof tripId === "string" && tripId) {
    revalidatePath(`/trips/${tripId}/memories`);
    revalidatePath(`/trips/${tripId}/post-trip`);
  }
}

export async function saveMemory(_previous: MemoryActionResult | null, form: FormData): Promise<MemoryActionResult> {
  const fields = Object.fromEntries(FIELDS.map((k) => [k, form.get(k) ?? ""]));
  const result = await saveMemoryAction(await memoryDeps(), fields);
  if (result.ok) refresh(fields.tripId);
  return result;
}

export async function deleteMemory(_previous: MemoryActionResult | null, form: FormData): Promise<MemoryActionResult> {
  const result = await deleteMemoryAction(await memoryDeps(), form.get("id"));
  if (result.ok) refresh(form.get("tripId"));
  return result;
}

export async function decideProposal(_previous: MemoryActionResult | null, form: FormData): Promise<MemoryActionResult> {
  const result = await decideProposalAction(await memoryDeps(), form.get("id"), form.get("decision"));
  if (result.ok) refresh(null);
  return result;
}

export async function generateProposals(_previous: MemoryActionResult | null, form: FormData): Promise<MemoryActionResult> {
  const tripId = form.get("tripId");
  const result = await generateProposalsAction(await memoryDeps(), tripId);
  if (result.ok) refresh(tripId);
  return result;
}
