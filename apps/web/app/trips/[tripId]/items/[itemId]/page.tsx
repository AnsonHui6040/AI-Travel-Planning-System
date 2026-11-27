import type { Metadata } from "next";
import Link from "next/link";
import { AdjustTime } from "../../../../../components/adjust-time";
import { ItemDeparture } from "../../../../../components/item-departure";
import { loadDayDraft } from "../../../../../lib/server/day-draft";
import { loadToday } from "../../../../../lib/server/today";
import { DAY_STATUS_LABELS, DayList, pickDay } from "../../days/day-list";
import "../../days/days.css";
import "../../../../today.css";

// 項目詳情（docs/verification/ux-logic-2026-11-27.md 第 5 節：清單每項一行，點進去才看時間、交通、照片）。
// 手機為單獨畫面；1024px 以上左邊是當日清單

export const metadata: Metadata = { title: "項目" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};
const MODE_LABELS: Record<string, string> = { walk: "步行", rail: "鐵路與地鐵", bus: "公車", taxi: "計程車與叫車", drive: "自駕" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ tripId: string; itemId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId, itemId } = await params;
  const { date } = await searchParams;
  const view = await loadDayDraft(tripId);
  const item = view.state === "ok" ? view.items[itemId] : undefined;
  if (view.state !== "ok" || !item) {
    return (
      <main className="screen days">
        <h1>項目</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個項目，或你不是成員。"}</p>
      </main>
    );
  }
  const holds = (d: (typeof view.days)[number]) => d.entries.some((e) => e.kind === "item" && e.item_id === itemId);
  const day = view.days.find((d) => d.date === date && holds(d)) ?? view.days.find(holds) ?? pickDay(view, date);
  const entry = day?.entries.find((e) => e.kind === "item" && e.item_id === itemId);
  const placed = day ? day.entries.flatMap((e) => (e.kind === "item" ? [e.item_id] : [])) : [];
  const nextId = placed[placed.indexOf(itemId) + 1];
  const next = nextId ? view.items[nextId] : undefined;
  const travel = nextId ? view.travel[`${itemId}>${nextId}`] : undefined;

  // 行程鎖定後：當日包的最遲離開、離開前檢查、導航與調整時間（每日草案沒有這個項目時以 ?date= 的當日包為準）
  const liveDate = entry && day ? day.date : date;
  const live = liveDate && (view.tripStatus === "locked" || view.tripStatus === "in_progress") ? await loadToday(tripId, liveDate) : null;
  const pack = live?.state === "ok" ? live.pack : null;
  const index = pack ? pack.entries.findIndex((e) => e.itemId === itemId) : -1;
  const packEntry = pack && index >= 0 ? pack.entries[index] : undefined;
  const directions = live?.state === "ok" ? live.directions[itemId] : undefined;
  const photo = item.photo.kind === "photos" ? item.photo.photos[0] : undefined;
  const back = `/trips/${tripId}/days${day ? `?date=${day.date}` : ""}`;

  return (
    <main className="screen wide days item-page">
      <div className="split" data-detail="open">
        {day ? (
          <section aria-label={day.date} className="split-list">
            <DayList tripId={tripId} view={view} day={day} currentItem={itemId} />
          </section>
        ) : (
          <div className="split-list" />
        )}
        <article aria-label={item.nameZh} className="split-detail item-detail">
          <Link className="back-link" href={back} aria-label="返回行程">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            行程
          </Link>
          <h1>{item.nameZh}</h1>
          <p className="tags">
            <span className="tag">{STATUS_LABELS[item.verificationStatus] ?? item.verificationStatus}</span>
            {item.atRisk ? <span className="tag risk">At Risk</span> : null}
            {day && entry ? <span className="tag">{DAY_STATUS_LABELS[day.status]}</span> : packEntry ? null : <span className="tag">尚未排入</span>}
          </p>
          <dl className="item-facts">
            {entry || packEntry ? (
              <div>
                <dt>時間</dt>
                <dd>
                  {entry?.start ?? packEntry?.start}–{entry?.end ?? packEntry?.end}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>停留</dt>
              <dd>{item.stayMinutes} 分鐘</dd>
            </div>
            {entry || packEntry ? (
              <div>
                <dt>下一站</dt>
                <dd>{next ? next.nameZh : (packEntry?.nextName ?? "沒有")}</dd>
              </div>
            ) : null}
            {travel ? (
              <div>
                <dt>交通</dt>
                <dd>{travel.estimated ? `${MODE_LABELS[travel.mode ?? ""] ?? "交通"}約 ${travel.minutes} 分鐘（估算，含緩衝）` : `約 ${travel.minutes} 分鐘（尚無估算）`}</dd>
              </div>
            ) : null}
            {packEntry?.leaveBy ? (
              <div>
                <dt>最遲離開</dt>
                <dd>{packEntry.leaveBy}</dd>
              </div>
            ) : null}
            {entry && entry.kind === "item" && entry.movable_from && entry.movable_to ? (
              <div>
                <dt>可移動範圍</dt>
                <dd>
                  {entry.movable_from}–{entry.movable_to} 開始
                </dd>
              </div>
            ) : null}
          </dl>
          {photo ? (
            <figure className="item-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.alt} loading="lazy" />
              <figcaption>{photo.credit}</figcaption>
            </figure>
          ) : null}
          {pack && index >= 0 ? <ItemDeparture pack={pack} index={index} /> : null}
          {pack && packEntry && view.canEdit ? (
            <AdjustTime tripId={tripId} itemId={itemId} itemName={item.nameZh} date={pack.date} start={packEntry.start} end={packEntry.end} baseVersion={pack.baseVersion} />
          ) : null}
          <p className="item-links">
            {directions ? (
              <a href={directions} target="_blank" rel="noopener noreferrer">
                在 Google Maps 導航
              </a>
            ) : null}
            <Link href={`/trips/${tripId}/items/${itemId}/photos`}>照片</Link>
          </p>
        </article>
      </div>
    </main>
  );
}
