import { checkBaseline, classifyBaseline } from "@atps/core";
import type { Metadata } from "next";
import { loadBaseline } from "../../../../lib/server/baseline";
import { BaselineForm } from "./baseline-form";
import { ConstraintGroups, IssueList } from "./baseline-summary";
import "../../../settings/settings.css";
import "./baseline.css";

export const metadata: Metadata = { title: "旅行基線" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  baseline: "基線",
  planning: "規劃中",
  locked: "已鎖定",
  in_progress: "進行中",
  ended: "已結束",
  archived: "已封存",
};

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export default async function BaselinePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadBaseline(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings baseline">
        <h1>旅行基線</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }

  const editable = view.canEdit && view.confirmedAt === null && view.tripStatus === "baseline";
  return (
    <main className="settings baseline">
      <h1>旅行基線</h1>
      <p className="trip-line">
        {view.tripName}：{STATUS_LABELS[view.tripStatus] ?? view.tripStatus}
        {view.confirmedAt ? `，Trip Baseline v1 已於 ${dateTime(view.confirmedAt)} 確認` : ""}
      </p>
      {view.unreadable ? <p className="status error">已儲存的基線格式不符合目前版本，請重新填寫後儲存。</p> : null}
      {editable ? (
        <BaselineForm tripId={tripId} saved={view.baseline} />
      ) : view.baseline ? (
        <div className="baseline-layout readonly">
          <div>
            <p className="muted">
              {view.confirmedAt ? "確認後的修改改為提出變更提案。" : "只有 Owner 與 Companion 可以編輯基線。"}
            </p>
            <ConstraintGroups constraints={classifyBaseline(view.baseline)} />
          </div>
          <aside className="baseline-side" aria-label="檢查結果">
            <IssueList issues={checkBaseline(view.baseline)} />
          </aside>
        </div>
      ) : (
        <p>尚未建立旅行基線。</p>
      )}
    </main>
  );
}
