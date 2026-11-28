import type { Metadata } from "next";
import { loadChecklists } from "../../../../lib/server/bookings";
import { NotAvailable, READ_ONLY } from "../bookings/parts";
import { CreateListForm } from "./list-forms";
import { ListRows } from "./parts";
import "./lists.css";

// 決策 0010 B：行程的清單（打包、待辦）。每份清單一行，內容另開；1024px 以上左清單、右內容。離線當日包也包含清單

export const metadata: Metadata = { title: "清單" };
export const dynamic = "force-dynamic";

export default async function ListsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadChecklists(tripId);
  if (view.state !== "ok") return <NotAvailable title="清單" state={view.state} />;
  return (
    <main className="screen wide lists">
      <header className="screen-head">
        <h1>清單</h1>
        <p>{view.tripName}</p>
      </header>
      <div className="split" data-detail="none">
        <section aria-label="所有清單" className="split-list">
          <ListRows view={view} currentId={null} />
          <div className="screen-actions">{view.canEdit ? <CreateListForm tripId={tripId} /> : <p className="muted">{READ_ONLY}</p>}</div>
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一份清單查看項目。</p>
        </div>
      </div>
    </main>
  );
}
