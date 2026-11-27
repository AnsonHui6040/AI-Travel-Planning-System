import Link from "next/link";
import { POST_TRIP_STATUS_LABELS } from "@atps/core";
import { loadPostTrip } from "../../../../lib/server/post-trip";
import { GenerateProposalsForm } from "../../../settings/memories/memory-forms";
import { PostTripStepForm } from "./post-trip-step-form";

// 旅後的「現在」：一次標記一個項目；全部標記（行程封存）後產生旅後記憶提案，由本人批准才寫入記憶（T40、T41）

export async function NowPost({ tripId }: { tripId: string }) {
  const view = await loadPostTrip(tripId);
  if (view.state !== "ok") {
    return (
      <main className="screen now">
        <h1>現在</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const base = `/trips/${tripId}`;
  const total = view.items.length;
  const marked = view.items.filter((i) => i.post_trip_status).length;
  const next = view.tripStatus === "ended" ? view.items.find((i) => !i.post_trip_status) : undefined;
  const head = (
    <header className="screen-head">
      <h1>{view.tripName}</h1>
      <p>{view.tripStatus === "archived" ? "旅後，已封存" : "旅後"}</p>
    </header>
  );

  if (next && view.canEdit) {
    return (
      <main className="screen now now-post">
        {head}
        <PostTripStepForm
          key={next.id}
          tripId={tripId}
          itemId={next.id}
          name={next.name_zh}
          options={next.allowed.map((s) => ({ value: s, label: POST_TRIP_STATUS_LABELS[s] }))}
          secondary={
            <Link className="ghost" href={`${base}/post-trip`}>
              全部項目與報告
            </Link>
          }
        >
          <p className="muted">
            第 {marked + 1} / {total} 項
          </p>
          <h2>{next.name_zh}</h2>
          <p>
            {next.date ? `${next.date.slice(5).replace("-", "/")} ${next.start ?? ""}`.trim() : "計畫外"}，{next.visited ? "去過" : "沒有去"}
          </p>
          <p className="muted">{next.visited ? "去過的項目可標為完成、想再去或不推薦。" : "沒有去的項目只可標為略過、取消或想再去。"}</p>
        </PostTripStepForm>
      </main>
    );
  }

  return (
    <main className="screen now now-post">
      {head}
      <section aria-label="旅後記憶提案" className="screen-body step-card">
        {view.tripStatus === "archived" ? (
          <>
            <h2>旅後記憶提案</h2>
            <p>已標記 {total} 個項目。依 Planned vs Actual 比較報告產生記憶提案，由你批准後才寫入記憶。</p>
            <p>
              <Link href="/settings/memories">到「我的記憶」批准或否決</Link>
            </p>
          </>
        ) : (
          <>
            <h2>旅後狀態</h2>
            <p>
              已標記 {marked} / {total} 項。{view.canEdit ? "" : "Owner 或 Companion 標記完成後行程封存。"}
            </p>
          </>
        )}
        <p>
          <Link href={`${base}/post-trip`}>全部項目與比較報告</Link>
        </p>
      </section>
      <div className="screen-actions">{view.tripStatus === "archived" ? <GenerateProposalsForm tripId={tripId} /> : null}</div>
    </main>
  );
}
