import type { Metadata } from "next";
import Link from "next/link";
import { loadCandidateList } from "../../../../../lib/server/research";
import { Candidate, Segment } from "../candidate-detail";
import { CandidateList, filterQuery, parseFilter } from "../candidate-list";
import "../candidates.css";

// 候選詳情：手機為單獨畫面（返回清單時保留篩選與捲動位置）；1024px 以上左清單、右詳情

export const metadata: Metadata = { title: "候選" };
export const dynamic = "force-dynamic";

export default async function CandidatePage({ params, searchParams }: { params: Promise<{ tripId: string; itemId: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { tripId, itemId } = await params;
  const filter = parseFilter((await searchParams).filter);
  const view = await loadCandidateList(tripId);
  const c = view.state === "ok" ? view.candidates.find((x) => x.id === itemId) : undefined;
  if (view.state !== "ok" || !c) {
    return (
      <main className="screen candidates">
        <h1>候選</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個候選，或你不是成員。"}</p>
      </main>
    );
  }
  const segments = view.segments.filter((s) => s.fromId === c.id || s.toId === c.id);
  return (
    <main className="screen wide candidates">
      <div className="split" data-detail="open">
        <section aria-label="候選清單" className="split-list">
          <h1 className="list-title">候選</h1>
          <CandidateList tripId={tripId} candidates={view.candidates} filter={filter} currentId={c.id} />
        </section>
        <div className="split-detail">
          <Link className="back-link" href={`/trips/${tripId}/candidates${filterQuery(filter)}`} aria-label="返回候選清單">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            候選
          </Link>
          <div className="scroll-area candidate-scroll">
            <Candidate c={c} />
            {segments.length > 0 ? (
              <section aria-labelledby="segments">
                <h2 id="segments">交通動線比較</h2>
                <p className="muted">全部為 AI 依官方資料的估算，並加上固定緩衝（每段 10 分鐘，每次轉乘再加 5 分鐘）。出發前請以 Google Maps 確認。</p>
                {segments.map((s) => (
                  <Segment key={s.id} s={s} />
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
