"use server";

import { revalidatePath } from "next/cache";
import {
  addListItemAction,
  createListAction,
  deleteListAction,
  deleteListItemAction,
  setListItemAssigneeAction,
  setListItemCheckedAction,
  type BookingActionResult,
} from "../../../../lib/server/bookings-core";
import { bookingActionDeps } from "../../../../lib/server/bookings";

// 決策 0010 B：清單。登入與速率限制在 bookings-core 內檢查（C-11）；Viewer 與非成員由資料庫拒絕

const refresh = (tripId: unknown, result: BookingActionResult) => {
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/lists`, "layout");
  return result;
};

const tripOf = (input: unknown) => (input && typeof input === "object" ? (input as { tripId?: unknown }).tripId : undefined);

export async function createList(input: unknown): Promise<BookingActionResult> {
  return refresh(tripOf(input), await createListAction(await bookingActionDeps(), input));
}

export async function deleteList(tripId: string, listId: string): Promise<BookingActionResult> {
  return refresh(tripId, await deleteListAction(await bookingActionDeps(), tripId, listId));
}

export async function addListItem(input: unknown): Promise<BookingActionResult> {
  return refresh(tripOf(input), await addListItemAction(await bookingActionDeps(), input));
}

export async function setListItemChecked(tripId: string, itemId: string, checked: boolean): Promise<BookingActionResult> {
  return refresh(tripId, await setListItemCheckedAction(await bookingActionDeps(), tripId, itemId, checked));
}

export async function setListItemAssignee(tripId: string, itemId: string, assignee: string): Promise<BookingActionResult> {
  return refresh(tripId, await setListItemAssigneeAction(await bookingActionDeps(), tripId, itemId, assignee));
}

export async function deleteListItem(tripId: string, itemId: string): Promise<BookingActionResult> {
  return refresh(tripId, await deleteListItemAction(await bookingActionDeps(), tripId, itemId));
}
