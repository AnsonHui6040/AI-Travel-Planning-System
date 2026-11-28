import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import { LIST_KIND_LABELS } from "../../../../lib/booking-format";
import type { ChecklistsView } from "../../../../lib/server/bookings";

// 決策 0010 B：清單畫面共用的部分（伺服器元件）

export type OkLists = Extract<ChecklistsView, { state: "ok" }>;

export function ListRows({ view, currentId }: { view: OkLists; currentId: string | null }) {
  return (
    <ScrollKeeper scrollKey={`lists:${view.tripId}`}>
      {view.lists.length === 0 ? <p className="muted">還沒有清單。打包清單與出發前待辦都可以放在這裡，離線也能查看。</p> : null}
      <ul aria-label="清單" className="rows">
        {view.lists.map((l) => (
          <li key={l.id}>
            <Link href={`/trips/${view.tripId}/lists/${l.id}`} aria-current={l.id === currentId ? "page" : undefined}>
              <span className="row-time">{LIST_KIND_LABELS[l.kind]}</span>
              <span className="row-name">{l.title}</span>
              <span className="row-meta">
                {l.items.filter((i) => i.checked).length}/{l.items.length} 完成
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ScrollKeeper>
  );
}
