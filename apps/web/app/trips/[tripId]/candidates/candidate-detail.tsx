import { PROVIDER_NAMES, RESEARCH_TRACKS, SCREENING_DIMENSIONS, SCREENING_LABELS, type AiProvider } from "@atps/core";
import { SafeLink, SafeMarkdown } from "../../../../components/safe-markdown";
import type { CandidateView, SegmentView } from "../../../../lib/server/research";

// 候選詳情（T24–T28）：八項評分、核實的事實、推薦原因、來源與交通動線比較。由清單點進來才顯示

export const TYPE_LABELS: Record<CandidateView["type"], string> = {
  attraction: "景點",
  restaurant: "餐飲",
  shopping: "購物",
  photography: "攝影",
  activity: "活動",
};

export const VERIFICATION_LABELS: Record<CandidateView["verificationStatus"], string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};

const GRADE_LABELS: Record<string, string> = {
  facility_official: "設施官方",
  official_transport_tourism: "官方交通或觀光機構",
  reliable_third_party: "可靠第三方",
  user_reviews: "使用者評論",
};

const FACT_LABELS: Record<CandidateView["facts"][number]["field"], string> = {
  opening_hours: "營業時間",
  closed_days: "休館日",
  admission: "門票",
  reservation: "預約",
  transport_service: "交通服務",
};

const MODE_LABELS: Record<string, string> = {
  walk: "步行",
  rail: "鐵路與地鐵",
  bus: "公車",
  taxi: "計程車與叫車",
  drive: "自駕",
};

const PLAN_LABELS: [keyof NonNullable<SegmentView["plans"]>, string][] = [
  ["recommended", "推薦"],
  ["fastest", "最快"],
  ["cheapest", "最便宜"],
  ["comfortable", "最舒適或低風險"],
];

export function Segment({ s }: { s: SegmentView }) {
  return (
    <article className="segment" aria-label={`${s.from}到${s.to}`}>
      <h3>
        {s.from}到{s.to}
      </h3>
      {s.plans ? (
        <table>
          <caption>四種方案（估算，含固定緩衝）</caption>
          <thead>
            <tr>
              <th scope="col">方案</th>
              <th scope="col">方式</th>
              <th scope="col">時間</th>
              <th scope="col">費用</th>
              <th scope="col">轉乘</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_LABELS.map(([key, name]) => {
              const mode = s.plans?.[key] ?? "";
              const e = s.estimates.find((x) => x.mode === mode);
              return (
                <tr key={key}>
                  <th scope="row">{name}</th>
                  <td>{MODE_LABELS[mode] ?? mode}</td>
                  <td>{e ? `約 ${e.total_minutes} 分鐘（含緩衝 ${e.buffer_minutes} 分鐘）` : ""}</td>
                  <td>{e?.price ? `約 ${e.price.amount} ${e.price.currency}` : mode === "walk" ? "免費" : "不明"}</td>
                  <td>{e ? `${e.transfers} 次` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <h4 className="label">估算來源</h4>
      <ul className="sources">
        {[...new Set(s.estimates.flatMap((e) => e.source_urls))].map((url) => (
          <li key={url}>
            <SafeLink href={url}>{url}</SafeLink>
          </li>
        ))}
      </ul>
      {s.mapsUrl ? (
        <p>
          <SafeLink href={s.mapsUrl}>在 Google Maps 確認這段路線</SafeLink>
        </p>
      ) : null}
    </article>
  );
}

export const JOB_LABELS: Record<string, string> = {
  queued: "排隊中",
  running: "研究中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function providerName(provider: string): string {
  return provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider as AiProvider] : provider;
}

export function Candidate({ c }: { c: CandidateView }) {
  // Research A–D 各自依旅行基線研究，彼此不參考對方結果
  const track = RESEARCH_TRACKS.find((t) => t.id === c.track);
  return (
    <article className="candidate" aria-label={c.nameZh}>
      <h3>
        {c.nameZh}
        {c.nameLocal && c.nameLocal !== c.nameZh ? <span className="local">{c.nameLocal}</span> : null}
      </h3>
      <p className="muted track">{track ? `${track.label}：${track.focus}` : "成員加入"}</p>
      <dl className="facts">
        <div>
          <dt>地區</dt>
          <dd>{c.area ?? "未填"}</dd>
        </div>
        <div>
          <dt>類型</dt>
          <dd>{TYPE_LABELS[c.type]}</dd>
        </div>
        <div>
          <dt>停留</dt>
          <dd>{c.stayMinutes} 分鐘</dd>
        </div>
        <div>
          <dt>核實</dt>
          <dd>{VERIFICATION_LABELS[c.verificationStatus]}</dd>
        </div>
        <div>
          <dt>Google 地點</dt>
          <dd>{c.placeId ? "已對應" : "未對應"}</dd>
        </div>
        <div>
          <dt>候選角色</dt>
          <dd>{c.role === "primary" ? "Primary" : "Backup"}</dd>
        </div>
        {c.zone ? (
          <div className="wide">
            <dt>分區</dt>
            <dd>
              {c.zone.name}
              {c.zone.transfers !== null && c.zone.minutes !== null
                ? `（估算：轉乘 ${c.zone.transfers} 次，約 ${c.zone.minutes} 分鐘）`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      <h4 className="label">篩選評分（0–5，5 為最適合）</h4>
      <dl className="scores" aria-label={`${c.nameZh}的篩選評分`}>
        {SCREENING_DIMENSIONS.map((d) => (
          <div key={d}>
            <dt>{SCREENING_LABELS[d]}</dt>
            <dd>{c.scores[d]}</dd>
          </div>
        ))}
      </dl>
      {c.facts.length > 0 ? (
        <>
          <h4 className="label">核實的事實</h4>
          <ul className="facts-list">
            {c.facts.map((f) => (
              <li key={f.field} className={f.status === "conflict" ? "conflict" : undefined}>
                {FACT_LABELS[f.field]}：
                {f.status === "conflict" ? "來源不一致，無法判定" : `${f.value ?? ""}（${GRADE_LABELS[f.grade ?? ""] ?? "來源不明"}）`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h4 className="label">推薦原因</h4>
      <SafeMarkdown source={c.reason} className="md" />
      {c.constraintNote ? (
        <>
          <h4 className="label">限制</h4>
          <SafeMarkdown source={c.constraintNote} className="md" />
        </>
      ) : null}
      <h4 className="label">來源</h4>
      {c.sources.length === 0 ? <p className="muted">沒有來源。</p> : null}
      <ul className="sources">
        {c.sources.map((s, i) => (
          <li key={i}>
            <SafeLink href={s.url}>{s.url}</SafeLink>
            <span className="muted">
              {GRADE_LABELS[s.grade] ?? s.grade}，取得於 {dateTime(s.fetched_at)}
            </span>
          </li>
        ))}
      </ul>
      {c.generatedBy ? (
        <p className="muted">
          由 {providerName(c.generatedBy.provider)}（{c.generatedBy.model}）產生
          {c.verifiedBy ? `，${providerName(c.verifiedBy.provider)}（${c.verifiedBy.model}）核實` : ""}
        </p>
      ) : null}
    </article>
  );
}

