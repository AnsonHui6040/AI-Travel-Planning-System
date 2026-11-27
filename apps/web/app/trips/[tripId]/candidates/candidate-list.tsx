import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import type { CandidateView } from "../../../../lib/server/research";
import { TYPE_LABELS, VERIFICATION_LABELS } from "./candidate-detail";

// 候選清單：篩選與每項一行（手機與 1024px 以上的左欄共用）。篩選放在網址，返回時保留

export const FILTERS = [
  { key: "all", label: "全部" },
  { key: "unverified", label: "未核實" },
  { key: "verified", label: "已核實" },
  { key: "backup", label: "Backup" },
] as const;

export type CandidateFilter = (typeof FILTERS)[number]["key"];

export function parseFilter(value: string | undefined): CandidateFilter {
  return FILTERS.some((f) => f.key === value) ? (value as CandidateFilter) : "all";
}

export function applyFilter(candidates: readonly CandidateView[], filter: CandidateFilter): CandidateView[] {
  if (filter === "unverified") return candidates.filter((c) => c.verificationStatus === "unverified");
  if (filter === "verified") return candidates.filter((c) => c.verificationStatus === "verified" || c.verificationStatus === "partially_verified");
  if (filter === "backup") return candidates.filter((c) => c.role === "backup");
  return [...candidates];
}

export const filterQuery = (filter: CandidateFilter) => (filter === "all" ? "" : `?filter=${filter}`);

export function CandidateList({
  tripId,
  candidates,
  filter,
  currentId,
}: {
  tripId: string;
  candidates: readonly CandidateView[];
  filter: CandidateFilter;
  currentId: string | null;
}) {
  const shown = applyFilter(candidates, filter);
  return (
    <>
      <nav aria-label="篩選" className="chips">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/trips/${tripId}/candidates${filterQuery(f.key)}`} aria-current={f.key === filter ? "page" : undefined}>
            {f.label}
          </Link>
        ))}
      </nav>
      <ScrollKeeper scrollKey={`candidates:${tripId}:${filter}`}>
        {shown.length === 0 ? <p className="muted">{candidates.length === 0 ? "還沒有候選。" : "沒有符合篩選的候選。"}</p> : null}
        <ul aria-label="候選" className="rows">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/trips/${tripId}/candidates/${c.id}${filterQuery(filter)}`} aria-current={c.id === currentId ? "page" : undefined}>
                <span className="row-meta">{TYPE_LABELS[c.type]}</span>
                <span className="row-name">{c.nameZh}</span>
                <span className={c.verificationStatus === "conflict" ? "row-meta risk" : "row-meta"}>
                  {VERIFICATION_LABELS[c.verificationStatus]}
                  {c.role === "backup" ? "，Backup" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ScrollKeeper>
    </>
  );
}
