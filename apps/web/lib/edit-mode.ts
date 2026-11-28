import { editMode, type EditMode, type TripStatus } from "@atps/core";

// 決策 0011：畫面上的生效方式與提示。鎖定後（或該日已批准）Owner 直接套用、Companion 成為提案

export function viewEditMode(tripStatus: string, dayStatuses: readonly string[], isOwner: boolean): EditMode {
  return editMode(tripStatus as TripStatus, dayStatuses as Parameters<typeof editMode>[1], isOwner ? "owner" : "companion");
}

export const EDIT_HINTS: Partial<Record<EditMode, string>> = {
  applied: "已鎖定的行程：你是 Owner，修改會直接套用並通知其他成員。",
  proposal: "已鎖定的行程：修改會成為提案，批准後生效。",
};

export const SUBMIT_LABELS: Record<"add" | "save", Partial<Record<EditMode, string>>> = {
  add: { direct: "新增", applied: "新增", proposal: "提出新增" },
  save: { direct: "儲存", applied: "儲存", proposal: "提出修改" },
};
