"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeRoleAction,
  createInviteAction,
  createReadonlyLinkAction,
  leaveTripAction,
  removeMemberAction,
  revokeInviteAction,
  revokeReadonlyLinkAction,
  type MembersActionResult,
} from "../../../../lib/server/members-core";
import { membersActionDeps } from "../../../../lib/server/members";

// T32：成員管理。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 members-core 內檢查（C-11）

const refresh = (form: FormData, result: MembersActionResult) => {
  const tripId = form.get("tripId");
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/members`);
  return result;
};

export async function createInvite(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await createInviteAction(await membersActionDeps(), form.get("tripId"), form.get("role")));
}

export async function revokeInvite(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await revokeInviteAction(await membersActionDeps(), form.get("invitationId")));
}

export async function changeRole(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await changeRoleAction(await membersActionDeps(), form.get("tripId"), form.get("userId"), form.get("role")));
}

export async function removeMember(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await removeMemberAction(await membersActionDeps(), form.get("tripId"), form.get("userId")));
}

export async function leaveTrip(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  const result = await leaveTripAction(await membersActionDeps(), form.get("tripId"));
  if (result.ok) redirect("/");
  return result;
}

export async function createReadonlyLink(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await createReadonlyLinkAction(await membersActionDeps(), form.get("tripId"), form.get("days")));
}

export async function revokeReadonlyLink(_previous: MembersActionResult | null, form: FormData): Promise<MembersActionResult> {
  return refresh(form, await revokeReadonlyLinkAction(await membersActionDeps(), form.get("linkId")));
}
