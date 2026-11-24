import type { Metadata } from "next";
import Link from "next/link";
import { TodayBody } from "../../../../components/today-body";
import { loadToday } from "../../../../lib/server/today";
import { SavePack } from "./save-pack";
import "../../../settings/settings.css";
import "../../../today.css";

// T35：當日行程（D11）。線上開啟時存入 IndexedDB；離線時由 service worker 改提供 /offline-today，從 IndexedDB 讀取

export const metadata: Metadata = { title: "當日行程" };
export const dynamic = "force-dynamic";

export default async function TodayPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadToday(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="settings today">
        <h1>當日行程</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="settings today">
      <h1>當日行程</h1>
      <p className="trip-line">
        {view.tripName}
        {view.pack ? `，${view.pack.date}` : ""}
      </p>
      {view.dates.length > 1 ? (
        <nav aria-label="日期" className="today-dates">
          {view.dates.map((d) => (
            <Link key={d} href={`/trips/${tripId}/today?date=${d}`} aria-current={d === view.pack?.date ? "page" : undefined}>
              {d.slice(5)}
            </Link>
          ))}
        </nav>
      ) : null}
      {view.pack ? (
        <>
          <SavePack pack={view.pack} />
          <TodayBody pack={view.pack} canEdit={view.canEdit} offline={false} />
        </>
      ) : (
        <p className="muted">還沒有已批准的每日行程。</p>
      )}
    </main>
  );
}
