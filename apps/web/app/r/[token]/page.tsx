import type { Metadata } from "next";
import { loadReadonlyTrip } from "../../../lib/server/readonly";
import "../../settings/settings.css";
import "./readonly.css";

// T33：唯讀連結（SH-08）。不必登入；只顯示已排入的行程與開放給唯讀連結的敏感欄位；
// 沒有任何表單或按鈕，不能修改、不能觸發 AI 或外部 API；不顯示照片（照片與地點資料需經成員權限或付費 API）。

export const metadata: Metadata = { title: "行程（唯讀）", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};
const FIELD_LABELS = { full_name: "全名", phone: "電話", email: "電子郵件" } as const;

const weekday = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

export default async function ReadonlyTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadReadonlyTrip(token);
  if (!view) {
    return (
      <main className="settings readonly">
        <h1>行程（唯讀）</h1>
        <p>連結無效、已撤銷或已過期。</p>
      </main>
    );
  }
  const dates = [...new Set(view.items.map((i) => i.scheduled_date))].sort();
  return (
    <main className="settings readonly">
      <h1>{view.trip.name}</h1>
      <p className="trip-line">
        唯讀檢視
        {view.trip.start_date && view.trip.end_date ? `，${view.trip.start_date} 至 ${view.trip.end_date}` : ""}
      </p>
      {dates.length === 0 ? <p className="muted">還沒有已批准的行程。</p> : null}
      {dates.map((date) => (
        <section key={date} aria-label={date}>
          <h2>{weekday(date)}</h2>
          <ul className="readonly-items">
            {view.items
              .filter((i) => i.scheduled_date === date)
              .map((i) => (
                <li key={i.id} aria-label={i.name_zh}>
                  <span className="time">
                    {i.scheduled_start ?? ""}–{i.scheduled_end ?? ""}
                  </span>
                  <span className="name">
                    {i.name_zh}
                    {i.name_local ? <small>{i.name_local}</small> : null}
                  </span>
                  <span className="status">
                    {STATUS_LABELS[i.verification_status] ?? i.verification_status}
                    {i.at_risk ? "，At Risk" : ""}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {view.sensitive.length > 0 ? (
        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading">聯絡資料</h2>
          <ul className="readonly-items">
            {view.sensitive.map((s) => (
              <li key={`${s.name}-${s.field}`}>
                <span className="name">{s.name}</span>
                <span>
                  {FIELD_LABELS[s.field]}：{s.value}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
