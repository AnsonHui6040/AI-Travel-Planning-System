import Link from "next/link";
import { orderTrips } from "../lib/home-order";
import { nowStop, tripPhase } from "../lib/now-view";
import { loadTrips } from "../lib/server/entry";
import { loadInbox } from "../lib/server/inbox";
import { loadToday } from "../lib/server/today";
import { SignOutForm } from "./entry-forms";
import { MarkAllReadForm } from "./inbox-forms";
import "./home.css";

// 首頁：行程卡片（目前行程在最上，旅行中顯示下一站）、未讀通知與 At Risk 項目（T31、SH-06）。
// 建立行程另開畫面（/trips/new）

export const dynamic = "force-dynamic";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

// 目前行程在旅行中時的下一站
async function nextStopLine(tripId: string): Promise<string | null> {
  const view = await loadToday(tripId, undefined);
  if (view.state !== "ok" || !view.pack) return null;
  const stop = nowStop(view.pack, new Date());
  if (!stop.next) return "今天的行程已結束";
  return `${stop.isToday ? "下一站" : "第一站"} ${stop.next.start} ${stop.next.name}${stop.next.leaveBy ? `，最遲 ${stop.next.leaveBy} 離開` : ""}`;
}

export default async function HomePage() {
  const [inbox, trips] = await Promise.all([loadInbox(), loadTrips()]);
  if (!inbox || !trips) {
    return (
      <main className="home">
        <h1>旅行規劃</h1>
        <p className="home-login">
          <Link className="pill-link" href="/login">
            登入
          </Link>
        </p>
      </main>
    );
  }
  const ordered = orderTrips(trips, new Date());
  const current = ordered[0] && ordered[0].rawStatus !== "ended" && ordered[0].rawStatus !== "archived" ? ordered[0] : undefined;
  const next = current && tripPhase(current.rawStatus) === "trip" ? await nextStopLine(current.id) : null;
  return (
    <main className="home">
      <header className="home-head">
        <h1>旅行規劃</h1>
        <Link className={trips.length === 0 ? "primary" : "secondary"} href="/trips/new">
          新行程
        </Link>
      </header>
      <section aria-labelledby="trips-heading">
        <h2 id="trips-heading">我的行程</h2>
        {trips.length === 0 ? (
          <p className="muted">還沒有行程。</p>
        ) : (
          <ul className="trip-cards">
            {ordered.map((t) => (
              <li key={t.id} className={t.id === current?.id ? "current" : undefined}>
                <Link href={`/trips/${t.id}/today`}>
                  <span className="trip-card-head">
                    <span className="trip-card-name">{t.name}</span>
                    <span className="tag">{t.status}</span>
                  </span>
                  <span className="muted">
                    {t.destination ?? "未填目的地"}，{t.dates ?? "未定日期"}
                  </span>
                  {t.id === current?.id && next ? <span className="trip-card-next">{next}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="unread-heading">
        <h2 id="unread-heading">未讀通知</h2>
        {inbox.notifications.length === 0 ? (
          <p className="muted">沒有未讀通知。</p>
        ) : (
          <>
            <ul className="inbox-list">
              {inbox.notifications.map((n) => (
                <li key={n.id}>
                  {n.tripId ? <Link href={`/trips/${n.tripId}/proposals`}>{n.tripName}</Link> : <span>{n.tripName}</span>}
                  <span>{n.label}</span>
                  <time dateTime={n.createdAt}>{formatTime(n.createdAt)}</time>
                </li>
              ))}
            </ul>
            <MarkAllReadForm />
          </>
        )}
      </section>
      <section aria-labelledby="risk-heading">
        <h2 id="risk-heading">At Risk 項目</h2>
        {inbox.atRisk.length === 0 ? (
          <p className="muted">沒有需要留意的項目。</p>
        ) : (
          <ul className="inbox-list">
            {inbox.atRisk.map((i) => (
              <li key={i.id}>
                <Link href={`/trips/${i.tripId}/items/${i.id}`}>{i.name}</Link>
                <span>{i.tripName}</span>
                <span>{i.date ?? "未排入日期"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav aria-label="設定" className="home-settings">
        <Link href="/settings/memories">記憶</Link>
        <Link href="/settings/ai">AI 設定</Link>
        <Link href="/settings/api-keys">API key</Link>
        <Link href="/styleguide">元件樣板</Link>
      </nav>
      <SignOutForm />
    </main>
  );
}
