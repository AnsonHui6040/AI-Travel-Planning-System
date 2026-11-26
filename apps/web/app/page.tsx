import Link from "next/link";
import { loadTrips } from "../lib/server/entry";
import { loadInbox } from "../lib/server/inbox";
import { CreateTripForm, SignOutForm } from "./entry-forms";
import { MarkAllReadForm } from "./inbox-forms";
import "./home.css";

// 首頁：未登入時導向登入；登入後顯示行程清單、建立行程、未讀通知與 At Risk 項目（T31、SH-06）

export const dynamic = "force-dynamic";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default async function HomePage() {
  const [inbox, trips] = await Promise.all([loadInbox(), loadTrips()]);
  return (
    <main className="home">
      <h1>旅行規劃</h1>
      {inbox && trips ? (
        <>
          <section aria-labelledby="trips-heading">
            <h2 id="trips-heading">我的行程</h2>
            {trips.length === 0 ? (
              <p className="muted">還沒有行程。</p>
            ) : (
              <ul className="trip-list">
                {trips.map((t) => (
                  <li key={t.id}>
                    <Link href={`/trips/${t.id}/today`}>{t.name}</Link>
                    <span className="muted">{t.destination ?? "未填目的地"}</span>
                    <span className="muted">{t.dates ?? "未定日期"}</span>
                    <span>{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="new-trip-heading">
            <h2 id="new-trip-heading">建立行程</h2>
            <p className="muted">建立後先填寫 Trip Baseline（日期、航班、住宿、固定活動）。</p>
            <CreateTripForm />
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
                      {n.tripId ? <Link href={`/trips/${n.tripId}/days`}>{n.tripName}</Link> : <span>{n.tripName}</span>}
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
                    <Link href={`/trips/${i.tripId}/days`}>{i.name}</Link>
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
        </>
      ) : (
        <p className="home-login">
          <Link className="pill-link" href="/login">
            登入
          </Link>
        </p>
      )}
    </main>
  );
}
