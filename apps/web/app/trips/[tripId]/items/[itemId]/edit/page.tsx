import type { Metadata } from "next";
import Link from "next/link";
import { canEnterDraft } from "@atps/core";
import { viewEditMode } from "../../../../../../lib/edit-mode";
import { VERIFICATION_LABELS } from "../../../../../../lib/item-labels";
import { loadDayDraft } from "../../../../../../lib/server/day-draft";
import { EditItemForm, ScheduleControls } from "../../item-forms";
import "../../item-edit.css";

// 決策 0010 E：修改、排序、移動、移回候選清單與刪除。由項目詳情進入。
// 行程鎖定前（且該日是草案）直接寫入；鎖定後或該日已批准，同一個畫面送出待批准提案

export const metadata: Metadata = { title: "編輯項目" };
export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  const { tripId, itemId } = await params;
  const view = await loadDayDraft(tripId);
  const item = view.state === "ok" ? view.items[itemId] : undefined;
  const closed = view.state === "ok" && (view.tripStatus === "ended" || view.tripStatus === "archived");
  if (view.state !== "ok" || !item || !view.canEdit || closed) {
    return (
      <main className="screen edit-item">
        <h1>編輯項目</h1>
        <p>
          {view.state === "signed_out"
            ? "請先登入。"
            : view.state === "ok" && item && !view.canEdit
              ? "只有 Owner 與 Companion 可以編輯。"
              : closed
                ? "行程已結束，不能再編輯。"
                : "找不到這個項目，或你不是成員。"}
        </p>
      </main>
    );
  }
  const day = view.days.find((d) => d.entries.some((e) => e.kind === "item" && e.item_id === itemId));
  const placed = day ? day.entries.flatMap((e) => (e.kind === "item" ? [e] : [])) : [];
  const index = placed.findIndex((e) => e.item_id === itemId);
  const entry = placed[index];
  const mode = viewEditMode(view.tripStatus, day ? [day.status] : [], view.isOwner);
  const short = (date: string) => date.slice(5).replace("-", "/");
  const where = day && entry ? `${short(day.date)} ${entry.start}–${entry.end}` : "候選清單";
  const back = `/trips/${tripId}/items/${itemId}${day ? `?date=${day.date}` : ""}`;

  return (
    <main className="screen edit-item">
      <header className="screen-head">
        <Link className="back-link" href={back} aria-label="返回項目">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {item.nameZh}
        </Link>
        <h1>編輯項目</h1>
        <p className="tags">
          <span className="tag">{where}</span>
          <span className="tag">{item.origin === "user" ? "使用者新增" : (VERIFICATION_LABELS[item.verificationStatus] ?? item.verificationStatus)}</span>
        </p>
      </header>
      <ScheduleControls
        tripId={tripId}
        itemId={itemId}
        itemName={item.nameZh}
        dates={view.days.map((d) => d.date)}
        current={day && entry ? { date: day.date, start: entry.start, end: entry.end } : null}
        canMoveUp={index > 0}
        canMoveDown={index >= 0 && index < placed.length - 1}
        canSchedule={canEnterDraft(item.verificationStatus) && item.candidateRole === "primary"}
      />
      <EditItemForm
        tripId={tripId}
        item={{ id: itemId, nameZh: item.nameZh, type: item.type, stayMinutes: item.stayMinutes, address: item.address, note: item.note }}
        mode={mode === "proposal" ? "proposal" : "direct"}
      />
    </main>
  );
}
