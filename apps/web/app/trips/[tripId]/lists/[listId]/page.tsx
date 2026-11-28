import type { Metadata } from "next";
import { ScrollKeeper } from "../../../../../components/scroll-keeper";
import { LIST_KIND_LABELS } from "../../../../../lib/booking-format";
import { loadChecklists } from "../../../../../lib/server/bookings";
import { BackLink, NotAvailable } from "../../bookings/parts";
import { AddItemForm, ChecklistItemRow, DeleteListButton } from "../list-forms";
import { ListRows } from "../parts";
import "../lists.css";

// 一份清單：項目可勾選完成、指定成員；未完成的在前面。刪除先確認。1024px 以上左清單、右內容

export const metadata: Metadata = { title: "清單" };
export const dynamic = "force-dynamic";

export default async function ListPage({ params }: { params: Promise<{ tripId: string; listId: string }> }) {
  const { tripId, listId } = await params;
  const view = await loadChecklists(tripId);
  if (view.state !== "ok") return <NotAvailable title="清單" state={view.state} />;
  const list = view.lists.find((l) => l.id === listId);
  const items = list ? [...list.items].sort((a, b) => Number(a.checked) - Number(b.checked)) : [];
  return (
    <main className="screen wide lists">
      <header className="screen-head">
        <BackLink href={`/trips/${tripId}/lists`} label="清單" />
        <h1>{list ? list.title : "清單"}</h1>
        {list ? (
          <p>
            {list.title === LIST_KIND_LABELS[list.kind] ? "" : `${LIST_KIND_LABELS[list.kind]}，`}
            {list.items.filter((i) => i.checked).length}/{list.items.length} 完成
          </p>
        ) : null}
      </header>
      <div className="split" data-detail="open">
        <section aria-label="所有清單" className="split-list">
          <ListRows view={view} currentId={listId} />
        </section>
        <div className="split-detail">
          {list ? (
            <>
              <ScrollKeeper scrollKey={`list:${listId}`}>
                {items.length === 0 ? <p className="muted">還沒有項目。</p> : null}
                <ul aria-label={`${list.title} 的項目`} className="rows checklist">
                  {items.map((i) => (
                    <ChecklistItemRow key={i.id} tripId={tripId} item={i} members={view.members} canEdit={view.canEdit} />
                  ))}
                </ul>
              </ScrollKeeper>
              {view.canEdit ? (
                <div className="screen-actions list-actions">
                  <AddItemForm tripId={tripId} listId={list.id} members={view.members} />
                  <DeleteListButton tripId={tripId} listId={list.id} title={list.title} />
                </div>
              ) : null}
            </>
          ) : (
            <p>找不到這份清單。</p>
          )}
        </div>
      </div>
    </main>
  );
}
