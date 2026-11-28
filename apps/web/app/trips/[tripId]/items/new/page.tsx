import type { Metadata } from "next";
import { viewEditMode } from "../../../../../lib/edit-mode";
import Link from "next/link";
import { loadDayDraft } from "../../../../../lib/server/day-draft";
import { searchPlaces } from "../../../../../lib/server/places";
import { createSupabaseServerClient } from "../../../../../lib/server/supabase";
import { AddItemForm } from "../item-forms";
import "../item-edit.css";

// 決策 0010 E、S：新增地點。有 Google Maps key 時先搜尋（伺服器以使用者本人的 key 呼叫 Places 文字搜尋）；
// D28：名稱、地址只即時顯示，選定後只保存 place_id，名稱欄預設為輸入的搜尋字。沒有 key 時只手動新增

export const metadata: Metadata = { title: "新增地點" };
export const dynamic = "force-dynamic";

export default async function NewItemPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ q?: string; place?: string }> }) {
  const { tripId } = await params;
  const { q, place } = await searchParams;
  const view = await loadDayDraft(tripId);
  const back = `/trips/${tripId}/days`;
  if (view.state !== "ok" || !view.canEdit || view.tripStatus === "ended" || view.tripStatus === "archived") {
    return (
      <main className="screen add-item">
        <h1>新增地點</h1>
        <p>
          {view.state === "signed_out"
            ? "請先登入。"
            : view.state === "no_baseline"
              ? "確認 Trip Baseline v1 後才能新增地點。"
              : view.state === "ok" && !view.canEdit
                ? "只有 Owner 與 Companion 可以新增地點。"
                : view.state === "ok"
                  ? "行程已結束，不能再新增地點。"
                  : "找不到這個行程，或你不是成員。"}
        </p>
      </main>
    );
  }
  const session = await createSupabaseServerClient();
  const { data } = await session.auth.getUser();
  const search = data.user ? await searchPlaces(data.user.id, q) : ({ state: "no_key" } as const);
  const results = search.state === "ok" ? search.results : [];
  const selected = results.find((r) => r.placeId === place);
  const query = search.state === "ok" || search.state === "error" ? search.query : "";
  const mode = viewEditMode(view.tripStatus, view.tripStatus === "locked" || view.tripStatus === "in_progress" ? ["approved"] : [], view.isOwner);

  return (
    <main className="screen add-item">
      <header className="screen-head">
        <Link className="back-link" href={back} aria-label="返回行程">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          行程
        </Link>
        <h1>新增地點</h1>
      </header>
      {search.state === "no_key" ? null : (
        <form method="get" role="search" className="place-search">
          <label className="sr-only" htmlFor="place-q">
            搜尋地點
          </label>
          <input id="place-q" name="q" type="search" maxLength={100} defaultValue={query} placeholder="店名或地點" autoComplete="off" />
          <button className="secondary" type="submit">
            搜尋
          </button>
        </form>
      )}
      {search.state === "error" ? <p className="error">{search.message}</p> : null}
      {search.state === "ok" ? (
        results.length === 0 ? (
          <p className="muted">沒有找到「{search.query}」，可以直接手動新增。</p>
        ) : (
          <div className="place-results">
            <ul aria-label="搜尋結果" className="rows">
              {results.map((r) => (
                <li key={r.placeId}>
                  <Link
                    href={`/trips/${tripId}/items/new?q=${encodeURIComponent(search.query)}&place=${encodeURIComponent(r.placeId)}`}
                    aria-current={selected?.placeId === r.placeId ? "true" : undefined}
                    replace
                  >
                    <span className="row-name">{r.name}</span>
                    <span className="row-meta">{r.address ?? ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="attribution">資料來源：Google Maps</p>
          </div>
        )
      ) : null}
      {selected ? <p className="selected-place">已選：{selected.name}</p> : null}
      <AddItemForm key={`${query}:${selected?.placeId ?? ""}`} tripId={tripId} dates={view.days.map((d) => d.date)} defaultName={query} placeId={selected?.placeId ?? null} mode={mode === "proposal" ? "proposal" : "direct"} />
    </main>
  );
}
