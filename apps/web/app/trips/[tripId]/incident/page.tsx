import type { Metadata } from "next";
import Link from "next/link";
import { loadIncidentEntry } from "../../../../lib/server/incident";
import { IncidentForm } from "./incident-form";
import { IncidentSteps } from "./incident-steps";
import "./incident.css";

// T38：出狀況（Incident Mode）第 1 步。分級、Snapshot 與替代方案由伺服器計算；批准前不改動行程

export const metadata: Metadata = { title: "出狀況" };
export const dynamic = "force-dynamic";

const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export default async function IncidentEntryPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadIncidentEntry(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="screen incident">
        <h1>出狀況</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const backHref = `/trips/${tripId}/today?date=${view.date}`;
  const open = view.canEdit && (view.tripStatus === "locked" || view.tripStatus === "in_progress");
  return (
    <main className="screen incident">
      <header className="screen-head">
        <Link className="back-link" href={backHref} aria-label="返回現在">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          現在
        </Link>
        <h1>出狀況</h1>
        <p className="trip-line">
          Incident Mode，{view.tripName}，{view.date.slice(5).replace("-", "/")}
        </p>
      </header>
      <IncidentSteps current={1} />
      {open ? (
        <IncidentForm tripId={tripId} date={view.date} items={view.items} backHref={backHref} />
      ) : (
        <p className="muted">{view.canEdit ? "行程鎖定後才能使用 Incident Mode。" : "只有 Owner 與 Companion 可以進入 Incident Mode。"}</p>
      )}
      {view.recent.length > 0 ? (
        <details className="incident-recent">
          <summary>最近的 Incident（{view.recent.length}）</summary>
          <ul>
            {view.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/trips/${tripId}/incident/${r.id}`}>
                  {r.level ?? "現場變更"}，{formatTime(r.createdAt, view.timezone)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
