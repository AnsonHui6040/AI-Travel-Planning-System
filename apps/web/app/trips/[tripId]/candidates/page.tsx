import { PROVIDER_NAMES, RESEARCH_TRACKS, SCREENING_DIMENSIONS, SCREENING_LABELS, type AiProvider } from "@atps/core";
import type { Metadata } from "next";
import { SafeLink, SafeMarkdown } from "../../../../components/safe-markdown";
import { loadCandidateList, type CandidateView } from "../../../../lib/server/research";
import { StartResearchForm } from "./start-research-form";
import "../../../settings/settings.css";
import "./candidates.css";

export const metadata: Metadata = { title: "Candidate List" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<CandidateView["type"], string> = {
  attraction: "景點",
  restaurant: "餐飲",
  shopping: "購物",
  photography: "攝影",
  activity: "活動",
};

const VERIFICATION_LABELS: Record<CandidateView["verificationStatus"], string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};

const GRADE_LABELS: Record<string, string> = {
  facility_official: "設施官方",
  official_transport_tourism: "官方交通或觀光機構",
  reliable_third_party: "可靠第三方",
  user_reviews: "使用者評論",
};

const FACT_LABELS: Record<CandidateView["facts"][number]["field"], string> = {
  opening_hours: "營業時間",
  closed_days: "休館日",
  admission: "門票",
  reservation: "預約",
  transport_service: "交通服務",
};

const JOB_LABELS: Record<string, string> = {
  queued: "排隊中",
  running: "研究中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function providerName(provider: string): string {
  return provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider as AiProvider] : provider;
}

function Candidate({ c }: { c: CandidateView }) {
  return (
    <article className="candidate" aria-label={c.nameZh}>
      <h3>
        {c.nameZh}
        {c.nameLocal && c.nameLocal !== c.nameZh ? <span className="local">{c.nameLocal}</span> : null}
      </h3>
      <dl className="facts">
        <div>
          <dt>地區</dt>
          <dd>{c.area ?? "未填"}</dd>
        </div>
        <div>
          <dt>類型</dt>
          <dd>{TYPE_LABELS[c.type]}</dd>
        </div>
        <div>
          <dt>停留</dt>
          <dd>{c.stayMinutes} 分鐘</dd>
        </div>
        <div>
          <dt>核實</dt>
          <dd>{VERIFICATION_LABELS[c.verificationStatus]}</dd>
        </div>
        <div>
          <dt>Google 地點</dt>
          <dd>{c.placeId ? "已對應" : "未對應"}</dd>
        </div>
        <div>
          <dt>候選角色</dt>
          <dd>{c.role === "primary" ? "Primary" : "Backup"}</dd>
        </div>
        {c.zone ? (
          <div className="wide">
            <dt>分區</dt>
            <dd>
              {c.zone.name}
              {c.zone.transfers !== null && c.zone.minutes !== null
                ? `（估算：轉乘 ${c.zone.transfers} 次，約 ${c.zone.minutes} 分鐘）`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      <h4 className="label">篩選評分（0–5，5 為最適合）</h4>
      <dl className="scores" aria-label={`${c.nameZh}的篩選評分`}>
        {SCREENING_DIMENSIONS.map((d) => (
          <div key={d}>
            <dt>{SCREENING_LABELS[d]}</dt>
            <dd>{c.scores[d]}</dd>
          </div>
        ))}
      </dl>
      {c.facts.length > 0 ? (
        <>
          <h4 className="label">核實的事實</h4>
          <ul className="facts-list">
            {c.facts.map((f) => (
              <li key={f.field} className={f.status === "conflict" ? "conflict" : undefined}>
                {FACT_LABELS[f.field]}：
                {f.status === "conflict" ? "來源不一致，無法判定" : `${f.value ?? ""}（${GRADE_LABELS[f.grade ?? ""] ?? "來源不明"}）`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4 className="label">推薦原因</h4>
      <SafeMarkdown source={c.reason} className="md" />
      {c.constraintNote ? (
        <>
          <h4 className="label">限制</h4>
          <SafeMarkdown source={c.constraintNote} className="md" />
        </>
      ) : null}
      <h4 className="label">來源</h4>
      <ul className="sources">
        {c.sources.map((s, i) => (
          <li key={i}>
            <SafeLink href={s.url}>{s.url}</SafeLink>
            <span className="muted">
              {GRADE_LABELS[s.grade] ?? s.grade}，取得於 {dateTime(s.fetched_at)}
            </span>
          </li>
        ))}
      </ul>
      {c.generatedBy ? (
        <p className="muted">
          由 {providerName(c.generatedBy.provider)}（{c.generatedBy.model}）產生
          {c.verifiedBy ? `，${providerName(c.verifiedBy.provider)}（${c.verifiedBy.model}）核實` : ""}
        </p>
      ) : null}
    </article>
  );
}

export default async function CandidatesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadCandidateList(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings candidates">
        <h1>Candidate List</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }

  const groups = RESEARCH_TRACKS.map((t) => ({ track: t, items: view.candidates.filter((c) => c.track === t.id) }));
  const others = view.candidates.filter((c) => c.track === null);

  return (
    <main className="settings candidates">
      <h1>Candidate List</h1>
      <p className="trip-line">{view.tripName}</p>
      <p className="muted">
        Research A–D 各自依旅行基線研究，彼此不參考對方結果。候選只列在這裡，不會自動排進行程；核實前一律為 Unverified，Unverified 與 Conflict 不會進入行程。
      </p>

      {view.canResearch ? <StartResearchForm tripId={tripId} /> : null}
      {!view.canResearch && view.tripStatus === "baseline" ? <p className="muted">確認 Trip Baseline v1 後才能開始研究。</p> : null}
      {view.latestJob ? (
        <p className="muted">
          最近一次研究：{JOB_LABELS[view.latestJob.status] ?? view.latestJob.status}（{dateTime(view.latestJob.createdAt)} 開始）
        </p>
      ) : null}

      {view.candidates.length === 0 ? <p>還沒有候選。</p> : null}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.track.id} aria-labelledby={`track-${g.track.id}`}>
            <h2 id={`track-${g.track.id}`}>
              {g.track.label}：{g.track.focus}
            </h2>
            {g.items.map((c) => (
              <Candidate key={c.id} c={c} />
            ))}
          </section>
        ))}
      {others.length > 0 ? (
        <section aria-labelledby="track-other">
          <h2 id="track-other">成員加入</h2>
          {others.map((c) => (
            <Candidate key={c.id} c={c} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
