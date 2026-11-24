import type { Metadata } from "next";
import { FEASIBILITY_LABELS, isDayBlocked, type DraftEntry } from "@atps/core";
import { loadDayDraft, type CardItem, type DayStatus, type TravelInfo } from "../../../../lib/server/day-draft";
import { ReverifyToggle } from "../../../inbox-forms";
import { ApproveDayForm } from "./approve-day-form";
import "../../../settings/settings.css";
import "./days.css";

export const metadata: Metadata = { title: "每日時段草案" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CardItem["verificationStatus"], string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};

const MODE_LABELS: Record<string, string> = {
  walk: "步行",
  rail: "鐵路與地鐵",
  bus: "公車",
  taxi: "計程車與叫車",
  drive: "自駕",
};

const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  draft: "草案",
  approved: "已批准",
  day_ready: "Day Ready",
  in_progress: "進行中",
  completed: "已完成",
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  planning: "規劃中",
  locked: "已鎖定",
  in_progress: "進行中",
  ended: "已結束",
  archived: "已封存",
};

const weekday = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

function travelText(t: TravelInfo | undefined): string {
  if (!t) return "最後一站";
  return t.estimated ? `${MODE_LABELS[t.mode ?? ""] ?? "交通"}約 ${t.minutes} 分鐘（估算，含緩衝）` : `約 ${t.minutes} 分鐘（尚無估算）`;
}

function Card({ entry, item, next, travel }: { entry: Extract<DraftEntry, { kind: "item" }>; item: CardItem; next: CardItem | null; travel: TravelInfo | undefined }) {
  return (
    <article className="day-card" aria-label={item.nameZh}>
      <div className="day-photo">
        {item.photo.kind === "photos" && item.photo.photos[0] ? (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.photo.photos[0].url} alt={item.photo.photos[0].alt} loading="lazy" />
            <figcaption>{item.photo.photos[0].credit}</figcaption>
          </figure>
        ) : item.photo.kind === "fallback" ? (
          <div className="photo-fallback">
            <strong>{item.photo.title}</strong>
            {item.photo.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="day-body">
        <h3>{item.nameZh}</h3>
        <dl>
          <div>
            <dt>到達</dt>
            <dd>{entry.start}</dd>
          </div>
          <div>
            <dt>停留</dt>
            <dd>{item.stayMinutes} 分鐘</dd>
          </div>
          <div>
            <dt>下一站</dt>
            <dd>{next ? next.nameZh : "沒有"}</dd>
          </div>
          <div>
            <dt>交通</dt>
            <dd>{travelText(travel)}</dd>
          </div>
          <div>
            <dt>狀態</dt>
            <dd>
              {STATUS_LABELS[item.verificationStatus]}
              {item.atRisk ? "，At Risk" : ""}
            </dd>
          </div>
          <div>
            <dt>可移動範圍</dt>
            <dd>
              {entry.movable_from}–{entry.movable_to} 開始
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export default async function DaysPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadDayDraft(tripId);
  if (view.state === "signed_out" || view.state === "not_found") {
    return (
      <main className="settings days">
        <h1>每日時段草案</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  if (view.state === "no_baseline") {
    return (
      <main className="settings days">
        <h1>每日時段草案</h1>
        <p className="trip-line">{view.tripName}</p>
        <p>確認 Trip Baseline v1 後才能產生每日草案。</p>
      </main>
    );
  }

  return (
    <main className="settings days">
      <h1>每日時段草案</h1>
      <p className="trip-line">
        {view.tripName}（{TRIP_STATUS_LABELS[view.tripStatus] ?? view.tripStatus}）
      </p>
      <p className="muted">
        依固定活動、時段敏感活動、高優先景點、餐飲、彈性活動的順序排入，只使用 Verified 與 Partially Verified 的候選，並核查營業時間、休館日、交通時間與固定活動前後的緩衝。未通過的項目留在
        Candidate List。草案在批准前不會改動行程；所有日期都批准後行程鎖定。
      </p>
      {view.isOwner && (view.tripStatus === "planning" || view.tripStatus === "locked") ? (
        <section aria-label="旅前自動再核實" className="reverify">
          <h2>旅前自動再核實：{view.reverifyEnabled ? "已開啟" : "未開啟"}</h2>
          <p className="muted">
            開啟後，出發前 7 天與前 1 天會以你的 API key 重新核實已排入行程的項目；資料可能已變動的項目標示 At Risk，並通知所有成員。可隨時關閉。
          </p>
          <ReverifyToggle tripId={tripId} enabled={view.reverifyEnabled} />
        </section>
      ) : null}
      {view.days.map((day) => {
        const placed = day.entries.flatMap((e) => (e.kind === "item" ? [e.item_id] : []));
        const nameOf = (id: string | null) => (id ? (view.items[id]?.nameZh ?? "") : "");
        return (
          <section key={day.date} aria-label={day.date}>
            <h2>
              {weekday(day.date)}
              <span className="day-status">{DAY_STATUS_LABELS[day.status]}</span>
            </h2>
            {day.entries.length === 0 ? <p className="muted">這天還沒有可排入的項目。</p> : null}
            {day.entries.map((entry) => {
              if (entry.kind === "fixed") {
                return (
                  <p key={`${entry.name}-${entry.start}`} className="fixed-row">
                    {entry.start}–{entry.end} 固定活動：{entry.name}
                  </p>
                );
              }
              const item = view.items[entry.item_id];
              if (!item) return null;
              const nextId = placed[placed.indexOf(entry.item_id) + 1];
              const next = nextId ? (view.items[nextId] ?? null) : null;
              return <Card key={entry.item_id} entry={entry} item={item} next={next} travel={nextId ? view.travel[`${entry.item_id}>${nextId}`] : undefined} />;
            })}
            {day.backups.length > 0 ? (
              <p className="muted">Backup：{day.backups.map((id) => view.items[id]?.nameZh ?? "").join("、")}</p>
            ) : null}
            {day.issues.length > 0 ? (
              <ul className="day-issues" aria-label={`${day.date} 提醒`}>
                {day.issues.map((issue) => (
                  <li key={`${issue.check}-${issue.item_id ?? ""}`}>
                    {issue.item_id ? `${nameOf(issue.item_id)}：` : ""}
                    {FEASIBILITY_LABELS[issue.check]}
                  </li>
                ))}
              </ul>
            ) : null}
            {day.returned.length > 0 ? (
              <p className="muted">
                未通過可行性驗證、回到地理分區（留在 Candidate List）：
                {day.returned
                  .map((r) => `${nameOf(r.item_id)}${r.checks.length > 0 ? `（${r.checks.map((c) => FEASIBILITY_LABELS[c]).join("、")}）` : "（當天放不下）"}`)
                  .join("、")}
              </p>
            ) : null}
            {view.canEdit && placed.length > 0 ? (
              // 批准後仍保留同一個元件，才能顯示結果訊息
              <ApproveDayForm
                tripId={tripId}
                date={day.date}
                baseVersion={view.baseVersion}
                label={weekday(day.date)}
                mode={!view.canApprove || day.status !== "draft" ? "hidden" : isDayBlocked(day.issues, day.date) ? "blocked" : "ready"}
              />
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
