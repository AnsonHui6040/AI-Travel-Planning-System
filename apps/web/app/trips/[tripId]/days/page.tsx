import type { Metadata } from "next";
import type { DraftEntry } from "@atps/core";
import { loadDayDraft, type CardItem, type TravelInfo } from "../../../../lib/server/day-draft";
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
      <p className="trip-line">{view.tripName}</p>
      <p className="muted">
        依固定活動、時段敏感活動、高優先景點、餐飲、彈性活動的順序排入，只使用 Verified 與 Partially Verified 的候選。這是草案，批准與鎖定前不會改動行程。
      </p>
      {view.days.map((day) => {
        const placed = day.entries.flatMap((e) => (e.kind === "item" ? [e.item_id] : []));
        return (
          <section key={day.date} aria-label={day.date}>
            <h2>{weekday(day.date)}</h2>
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
            {day.unplaced.length > 0 ? (
              <p className="muted">放不下、留在 Candidate List：{day.unplaced.map((id) => view.items[id]?.nameZh ?? "").join("、")}</p>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
