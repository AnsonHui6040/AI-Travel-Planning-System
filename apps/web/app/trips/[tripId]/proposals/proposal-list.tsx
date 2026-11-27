import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import type { ProposalView } from "../../../../lib/server/proposals";

// 提案清單：每項一行（手機與 1024px 以上的左欄共用）

export const STATUS_LABELS = { pending: "待批准", applied: "已套用", rejected: "已否決", invalidated: "已失效" } as const;

export const formatTime = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
};

export function ProposalTabs({ tripId, view }: { tripId: string; view: "proposals" | "log" }) {
  return (
    <nav aria-label="分類" className="chips">
      <Link href={`/trips/${tripId}/proposals`} aria-current={view === "proposals" ? "page" : undefined}>
        提案
      </Link>
      <Link href={`/trips/${tripId}/proposals?view=log`} aria-current={view === "log" ? "page" : undefined}>
        Change Log
      </Link>
    </nav>
  );
}

export function ProposalList({ tripId, proposals, currentId }: { tripId: string; proposals: readonly ProposalView[]; currentId: string | null }) {
  const pending = proposals.filter((p) => p.status === "pending").length;
  return (
    <>
      <p className="muted">待批准 {pending} 個。先批准的提案先套用；行程更新後，其他基於舊版本的提案會失效。</p>
      <ScrollKeeper scrollKey={`proposals:${tripId}`}>
        {proposals.length === 0 ? <p className="muted">還沒有提案。</p> : null}
        <ul aria-label="提案清單" className="rows proposal-rows">
          {proposals.map((p) => (
            <li key={p.id} aria-label={p.summary}>
              <Link href={`/trips/${tripId}/proposals/${p.id}`} aria-current={p.id === currentId ? "page" : undefined}>
                <span className={`proposal-status ${p.status}`}>{STATUS_LABELS[p.status]}</span>
                <span className="row-name">{p.summary}</span>
                <span className="row-meta">{formatTime(p.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </ScrollKeeper>
    </>
  );
}
