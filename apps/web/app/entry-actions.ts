"use server";

import { redirect } from "next/navigation";
import { createTripAction, sendMagicLinkAction, type EntryActionResult } from "../lib/server/entry-core";
import { entryDeps, signOut } from "../lib/server/entry";

// 登入、建立行程與登出。Next.js 對 Server Action 比對 Origin 與 Host

export async function sendMagicLink(_previous: EntryActionResult | null, form: FormData): Promise<EntryActionResult> {
  return sendMagicLinkAction(await entryDeps(), { email: form.get("email"), next: form.get("next") });
}

export async function createTrip(_previous: EntryActionResult | null, form: FormData): Promise<EntryActionResult> {
  const result = await createTripAction(await entryDeps(), { name: form.get("name"), destination: form.get("destination") });
  if (result.ok && result.tripId) redirect(`/trips/${result.tripId}/baseline`);
  return result;
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
