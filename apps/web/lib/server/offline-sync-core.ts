import { queuedToProposal } from "@atps/offline";
import { changePayload, hhmm, isoDate, uuid, type ChangePayload } from "@atps/schemas";
import { z } from "zod";

// T35（SH-05）：離線排入佇列的修改於恢復網路時送出，一律建立待批准提案（minor_non_incident），
// 保留排入佇列時的 base version；批准時依 SH-04 比對版本。只接受同一天內改時段；
// 項目名稱由伺服器讀取。權限：Owner、Companion（成員本人為提出者）。

const body = z
  .strictObject({
    itemId: uuid,
    date: isoDate,
    start: hhmm,
    end: hhmm,
    baseVersion: z.int().min(0).max(1_000_000),
  })
  .refine((b) => b.start < b.end, "結束時間須晚於開始時間");

export interface OfflineSyncDeps {
  canEdit: (tripId: string) => Promise<boolean>;
  // 以使用者 session 讀取（RLS）；不屬於此行程時為 null
  loadItem: (tripId: string, itemId: string) => Promise<{ name_zh: string; scheduled_date: string | null } | null>;
  createProposal: (input: { tripId: string; memberId: string; baseVersion: number; change: ChangePayload; impactScope: { dates: string[] } }) => Promise<void>;
}

export async function syncOfflineChange(
  deps: OfflineSyncDeps,
  input: { userId: string; tripId: unknown; body: unknown },
): Promise<{ status: number; message: string }> {
  const tripId = uuid.safeParse(input.tripId);
  const parsed = body.safeParse(input.body);
  if (!tripId.success || !parsed.success) return { status: 400, message: "修改內容不正確" };
  if (!(await deps.canEdit(tripId.data))) return { status: 403, message: "只有 Owner 與 Companion 可以提出修改" };
  const item = await deps.loadItem(tripId.data, parsed.data.itemId);
  if (!item) return { status: 404, message: "找不到這個項目" };
  if (item.scheduled_date !== parsed.data.date) return { status: 409, message: "項目已不在這一天，請重新整理" };

  const proposal = queuedToProposal({
    id: "",
    tripId: tripId.data,
    itemId: parsed.data.itemId,
    itemName: item.name_zh,
    date: parsed.data.date,
    start: parsed.data.start,
    end: parsed.data.end,
    baseVersion: parsed.data.baseVersion,
    queuedAt: "",
  });
  await deps.createProposal({
    tripId: tripId.data,
    memberId: input.userId,
    baseVersion: proposal.baseVersion,
    change: changePayload.parse(proposal.change),
    impactScope: { dates: [parsed.data.date] },
  });
  return { status: 201, message: "已建立提案" };
}
