import type { Metadata } from "next";
import Link from "next/link";
import { loadIncidentEntry } from "../../../../lib/server/incident";
import { IncidentForm } from "./incident-form";
import "../../../settings/settings.css";
import "./incident.css";

// T38：Incident Mode 入口。分級、Snapshot 與替代方案由伺服器計算；批准前不改動行程

export const metadata: Metadata = { title: "Incident Mode" };
export const dynamic = "force-dynamic";

const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export default async function IncidentEntryPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadIncidentEntry(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="settings incident">
        <h1>Incident Mode</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="settings incident">
      <h1>Incident Mode</h1>
      <p className="trip-line">
        {view.tripName}，{view.date}
      </p>
      {view.canEdit && (view.tripStatus === "locked" || view.tripStatus === "in_progress") ? (
        <>
          <p className="muted">只重新安排到下一個 Hard Constraint 為止。替代方案依同區域、鄰近區域、交換今日順序、使用另一日候選、刪減活動的次序產生，批准其中一個之前行程不會改動。</p>
          <IncidentForm tripId={tripId} date={view.date} items={view.items} />
        </>
      ) : (
        <p className="muted">{view.canEdit ? "行程鎖定後才能使用 Incident Mode。" : "只有 Owner 與 Companion 可以進入 Incident Mode。"}</p>
      )}
      {view.recent.length > 0 ? (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading">最近的 Incident</h2>
          <ul className="incident-recent">
            {view.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/trips/${tripId}/incident/${r.id}`}>
                  {r.level ?? "現場變更"}，{formatTime(r.createdAt, view.timezone)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        <Link href={`/trips/${tripId}/today?date=${view.date}`}>回到當日行程</Link>
      </p>
    </main>
  );
}
