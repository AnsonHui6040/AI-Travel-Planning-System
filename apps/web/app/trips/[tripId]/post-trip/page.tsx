import type { Metadata } from "next";
import { POST_TRIP_STATUS_LABELS, PROVIDER_NAMES, type AiProvider } from "@atps/core";
import { loadPostTrip } from "../../../../lib/server/post-trip";
import { PostTripStatusForm } from "./post-trip-form";
import "../../../settings/settings.css";
import "./post-trip.css";

// T40：旅後狀態標記與 MEM-04 比較報告（Planned vs Actual）。報告是 T41 旅後記憶提案的依據，本頁不寫入記憶

export const metadata: Metadata = { title: "旅後回顧" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = { attraction: "景點", restaurant: "餐飲", shopping: "購物", photography: "攝影", activity: "活動" };
const TRIP_STATUS: Record<string, string> = { ended: "已結束", archived: "已封存" };

const signed = (minutes: number) => (minutes > 0 ? `多 ${minutes} 分鐘` : minutes < 0 ? `少 ${-minutes} 分鐘` : "相同");
const provider = (p: string | null, model: string | null) => (p ? `${PROVIDER_NAMES[p as AiProvider] ?? p}（${model ?? "未記錄模型"}）` : "使用者新增");

export default async function PostTripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadPostTrip(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings post-trip">
        <h1>旅後回顧</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const r = view.report;
  const editable = view.canEdit && view.tripStatus === "ended";
  const marked = view.items.filter((i) => i.post_trip_status).length;
  return (
    <main className="settings post-trip">
      <h1>旅後回顧</h1>
      <p className="trip-line">
        {view.tripName}
        <span className="post-trip-status">{TRIP_STATUS[view.tripStatus] ?? "旅行尚未結束"}</span>
      </p>

      <section aria-label="旅後狀態">
        <h2>旅後狀態</h2>
        <p className="muted">
          {view.tripStatus === "archived"
            ? "所有項目都已標記，行程已封存。"
            : view.tripStatus === "ended"
              ? `已標記 ${marked} / ${view.items.length} 項。全部標記後行程封存。實際去過的項目才可標為完成或不推薦。`
              : "最後一日產生 Actual Timeline 後才能標記。"}
        </p>
        {view.items.length > 0 ? (
          <ul className="post-trip-items">
            {view.items.map((item) => (
              <li key={item.id}>
                <div className="post-trip-item-head">
                  <h3>{item.name_zh}</h3>
                  <span className="muted">{item.date ?? "計畫外"}</span>
                  <span className={item.visited ? "post-trip-visited" : "muted"}>{item.visited ? "去過" : "沒有去"}</span>
                  {item.post_trip_status ? <span className="post-trip-current">{POST_TRIP_STATUS_LABELS[item.post_trip_status]}</span> : null}
                </div>
                {editable ? (
                  <PostTripStatusForm
                    tripId={tripId}
                    itemId={item.id}
                    name={item.name_zh}
                    current={item.post_trip_status}
                    options={item.allowed.map((s) => ({ value: s, label: POST_TRIP_STATUS_LABELS[s] }))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有需要標記的項目。</p>
        )}
      </section>

      <section aria-label="比較報告">
        <h2>Planned vs Actual 比較報告</h2>
        <p className="muted">依 {view.daysWithTimeline} 天的 Actual Timeline 計算。之後的旅後記憶提案以這份報告為依據，需由你批准才會寫入記憶。</p>

        <h3>停留時間差異</h3>
        {r.stayDifferences.length > 0 ? (
          <ul className="post-trip-report">
            {r.stayDifferences.map((s) => (
              <li key={`${s.date}-${s.itemId}`}>
                <span>{s.name_zh}</span>
                <span className="muted">
                  排定 {s.plannedMinutes} 分鐘，實際 {s.actualMinutes} 分鐘，{signed(s.diffMinutes)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有同時記錄到達與離開的項目。</p>
        )}

        <h3>交通估算差異</h3>
        {r.transportDifferences.length > 0 ? (
          <ul className="post-trip-report">
            {r.transportDifferences.map((t) => (
              <li key={`${t.date}-${t.fromItemId}-${t.toItemId}`}>
                <span>
                  {t.fromName} 到 {t.toName}
                </span>
                <span className="muted">
                  估算 {t.estimatedMinutes} 分鐘，實際 {t.actualMinutes} 分鐘，{signed(t.diffMinutes)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有可比較的移動（需要交通估算與前後兩站的實際時間）。</p>
        )}

        <h3>實際用上的 Backup</h3>
        {r.backupsUsed.length > 0 ? (
          <ul className="post-trip-report">
            {r.backupsUsed.map((b) => (
              <li key={`${b.date}-${b.itemId}`}>
                <span>{b.name_zh}</span>
                <span className="muted">
                  {b.date}，{b.backup ? "Backup" : "計畫外"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有用上 Backup。</p>
        )}

        <h3>過密時段</h3>
        {r.crowdedSlots.length > 0 ? (
          <ul className="post-trip-report">
            {r.crowdedSlots.map((c) => (
              <li key={`${c.date}-${c.from}`}>
                <span>
                  {c.date} {c.from}–{c.until}
                </span>
                <span className="muted">{c.reasons.join("、")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有過密的時段。</p>
        )}

        <h3>證實不可靠的建議</h3>
        {r.unreliableRecommendations.length > 0 ? (
          <ul className="post-trip-report">
            {r.unreliableRecommendations.map((u) => (
              <li key={u.itemId}>
                <span>{u.name_zh}</span>
                <span className="muted">
                  {provider(u.provider, u.model)}，{u.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有標示不推薦的項目。</p>
        )}

        <h3>最喜歡的活動類型</h3>
        {r.favoriteActivityTypes.length > 0 ? (
          <ol className="post-trip-report">
            {r.favoriteActivityTypes.map((f) => (
              <li key={f.type}>
                <span>{TYPE_LABELS[f.type] ?? f.type}</span>
                <span className="muted">
                  {f.score} 分，{f.count} 個項目
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">還沒有標示完成或想再去的項目。</p>
        )}
      </section>
    </main>
  );
}
