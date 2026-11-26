import Link from "next/link";
import { loadInbox } from "../lib/server/inbox";
import { MarkAllReadForm } from "./inbox-forms";
import "./home.css";

// T31：成員開啟 App 時顯示未讀通知與 At Risk 項目（SH-06）

export const dynamic = "force-dynamic";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default async function HomePage() {
  const inbox = await loadInbox();
  return (
    <main className="home">
      <h1>旅行規劃</h1>
      {inbox ? (
        <>
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
          </nav>
        </>
      ) : null}
    </main>
  );
}
