"use server";

import { redirect } from "next/navigation";
import { acceptInviteAction, type MembersActionResult } from "../../../lib/server/members-core";
import { membersActionDeps } from "../../../lib/server/members";

// T32：受邀者以本人的 session 接受邀請，成功後前往行程

export async function acceptInvite(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  const result = await acceptInviteAction(await membersActionDeps(), form.get("token"));
  if (result.ok && result.tripId) redirect(`/trips/${result.tripId}/days`);
  return result;
}
