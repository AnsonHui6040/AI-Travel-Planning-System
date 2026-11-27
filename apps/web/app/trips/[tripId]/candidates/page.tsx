import type { Metadata } from "next";
import { loadCandidateList } from "../../../../lib/server/research";
import { JOB_LABELS, dateTime } from "./candidate-detail";
import { CandidateList, parseFilter } from "./candidate-list";
import { StartResearchForm } from "./start-research-form";
import "./candidates.css";

// 候選（T24–T28）：清單每項一行，點進去才看評分、來源與交通（docs/verification/ux-logic-2026-11-27.md 第 6 節）。
// Research A–D 各自依旅行基線研究；候選不會自動排進行程，核實前一律為 Unverified

export const metadata: Metadata = { title: "候選" };
export const dynamic = "force-dynamic";

export default async function CandidatesPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { tripId } = await params;
  const filter = parseFilter((await searchParams).filter);
  const view = await loadCandidateList(tripId);
  if (view.state !== "ok") {
    return (
      <main className="screen candidates">
        <h1>候選</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="screen wide candidates">
      <header className="screen-head">
        <h1>候選</h1>
        <p className="trip-line">
          {view.tripName}
          {view.latestJob ? `，最近一次研究：${JOB_LABELS[view.latestJob.status] ?? view.latestJob.status}（${dateTime(view.latestJob.createdAt)} 開始）` : ""}
        </p>
      </header>
      <div className="split" data-detail="none">
        <section aria-label="候選清單" className="split-list">
          <CandidateList tripId={tripId} candidates={view.candidates} filter={filter} currentId={null} />
          {!view.canResearch && view.tripStatus === "baseline" ? <p className="muted">確認 Trip Baseline v1 後才能開始研究。</p> : null}
          {view.canResearch ? (
            <div className="screen-actions">
              <StartResearchForm tripId={tripId} />
            </div>
          ) : null}
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一個候選查看八項評分、核實的事實、來源與交通動線。未核實與 Conflict 的候選不會排入行程。</p>
        </div>
      </div>
    </main>
  );
}
