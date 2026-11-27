import Link from "next/link";
import type { ReactNode } from "react";
import { isDayBlocked } from "@atps/core";
import { planningSteps, type StepKey } from "../../../../lib/now-view";
import { loadDayDraft } from "../../../../lib/server/day-draft";
import { loadCandidateList } from "../../../../lib/server/research";
import type { TripHeader } from "../../../../lib/server/trip-nav";
import { StartResearchForm } from "../candidates/start-research-form";

// 規劃中的「現在」：基線、研究、候選、每日、批准，只顯示目前步驟與它的主要按鈕

const STEP_NUMBER: Record<StepKey, number> = { baseline: 1, research: 2, candidates: 3, days: 4, approve: 5 };
const STEP_TITLE: Record<StepKey, string> = {
  baseline: "填寫基線",
  research: "研究候選",
  candidates: "選擇候選",
  days: "檢查每日草案",
  approve: "批准每日行程",
};
const JOB_LABELS: Record<string, string> = { queued: "排隊中", running: "研究中", completed: "已完成", failed: "失敗", cancelled: "已取消" };

const short = (date: string) => date.slice(5).replace("-", "/");

export async function NowPlanning({ tripId, header }: { tripId: string; header: Extract<TripHeader, { state: "ok" }> }) {
  const [list, draft] = await Promise.all([loadCandidateList(tripId), loadDayDraft(tripId)]);
  const candidates = list.state === "ok" ? list.candidates : [];
  const job = list.state === "ok" ? list.latestJob : null;
  const usable = candidates.filter((c) => c.verificationStatus === "verified" || c.verificationStatus === "partially_verified").length;
  const unverified = candidates.filter((c) => c.verificationStatus === "unverified").length;
  const backups = candidates.filter((c) => c.role === "backup").length;
  const researchRunning = job?.status === "queued" || job?.status === "running";
  const days =
    draft.state === "ok"
      ? draft.days.map((d) => ({ date: d.date, status: d.status, placed: d.entries.filter((e) => e.kind === "item").length, blocked: isDayBlocked(d.issues, d.date), issues: d.issues.length }))
      : [];
  const steps = planningSteps({ tripStatus: header.tripStatus, candidates: candidates.length, usable, unverified, researchRunning, days });
  const canEdit = header.role === "owner" || header.role === "companion";
  const base = `/trips/${tripId}`;
  const title = `第 ${STEP_NUMBER[steps.current]} 步：${STEP_TITLE[steps.current]}`;
  const focus = steps.focusDate;
  const approved = days.filter((d) => d.status !== "draft").length;
  const placed = days.reduce((sum, d) => sum + d.placed, 0);

  let lines: string[] = [];
  let action: ReactNode = null;
  switch (steps.current) {
    case "baseline":
      lines = ["填寫日期、航班、住宿與固定活動。確認後 AI 才開始研究，之後的修改改為提出變更提案。"];
      if (canEdit) action = <Link className="primary" href={`${base}/baseline`}>填寫基線</Link>;
      break;
    case "research":
      lines = [
        job ? `最近一次研究：${JOB_LABELS[job.status] ?? job.status}` : "Research A–D 各自依基線研究景點、餐飲、購物與攝影，彼此不參考對方結果。",
        "研究使用你在設定頁輸入的 API key。",
      ];
      if (list.state === "ok" && list.canResearch && !researchRunning) action = <StartResearchForm tripId={tripId} />;
      break;
    case "candidates":
      lines = [`${candidates.length} 個候選，${unverified} 個未核實`, `Backup ${backups} 個。未核實與 Conflict 的候選不會排入每日。`];
      action = <Link className="primary" href={`${base}/candidates${unverified > 0 ? "?filter=unverified" : ""}`}>檢視候選</Link>;
      break;
    case "days":
      lines = [
        `${days.length} 天草案，已排入 ${placed} 項`,
        focus ? `${short(focus)} 還有需要處理的提醒，處理後才能批准。` : "每天至少要排入一個項目。",
      ];
      action = <Link className="primary" href={`${base}/days${focus ? `?date=${focus}` : ""}`}>檢視每日草案</Link>;
      break;
    case "approve":
      lines = [`已批准 ${approved} / ${days.length} 天`, "所有日期批准後行程鎖定，之後的修改改為提案。"];
      if (canEdit && focus) action = <Link className="primary" href={`${base}/days?date=${focus}`}>批准 {short(focus)}</Link>;
      break;
  }

  return (
    <main className="screen now now-planning">
      <header className="screen-head">
        <h1>{header.tripName}</h1>
        <p>規劃中</p>
      </header>
      <ol aria-label="規劃步驟" className="steps">
        {steps.steps.map((s) => (
          <li key={s.key} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="step-mark" aria-hidden="true" />
            {s.label}
            {s.state === "done" ? <span className="sr-only">（完成）</span> : null}
          </li>
        ))}
      </ol>
      <section aria-label={title} className="screen-body step-card">
        <h2>{title}</h2>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {!canEdit ? <p className="muted">Owner 或 Companion 完成這一步後才會往下。</p> : null}
        {steps.current === "research" && researchRunning ? <p className="muted">研究完成後候選會出現在「更多」的候選頁。</p> : null}
      </section>
      <div className="screen-actions">{action}</div>
    </main>
  );
}
