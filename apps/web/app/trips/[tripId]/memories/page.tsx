import type { Metadata } from "next";
import { CONSTRAINT_CATALOG } from "@atps/memory";
import { loadTripMemories } from "../../../../lib/server/memories";
import { EditMemoryForm, NewMemoryForm } from "../../../settings/memories/memory-forms";
import "../../../settings/settings.css";
import "../../../settings/memories/memories.css";

// T41：共同行程的記憶（MEM-07、MEM-08）。合併所有成員的記憶；限制有衝突時取最保守值並標示，不顯示來源成員

export const metadata: Metadata = { title: "行程記憶" };
export const dynamic = "force-dynamic";

const LAYER: Record<string, string> = { personal: "個人偏好", planning_rules: "Planning Rules", trip_context: "本趟旅行" };
const KIND: Record<string, string> = { constraint: "限制", preference: "偏好" };

export default async function TripMemoriesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadTripMemories(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings memories">
        <h1>行程記憶</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const constraints = view.merged.filter((m) => m.kind === "constraint");
  const preferences = view.merged.filter((m) => m.kind === "preference");
  const list = (rows: typeof view.merged) =>
    rows.length > 0 ? (
      <ul className="memory-list">
        {rows.map((m, i) => (
          <li key={`${m.layer}-${m.item}-${m.value}-${i}`}>
            <div className="memory-head">
              <span className="memory-item">{m.item}</span>
              <span>
                {m.value}
                {m.unit ? ` ${m.unit}` : ""}
              </span>
              <span className="muted">{LAYER[m.layer]}</span>
              {m.conflict ? <span className="memory-conflict">成員間有不同設定，已取最保守值</span> : null}
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">沒有。</p>
    );

  return (
    <main className="settings memories">
      <h1>行程記憶</h1>
      <p className="trip-line muted">{view.tripName}</p>
      <section aria-label="合併後的限制">
        <h2>限制</h2>
        {list(constraints)}
      </section>
      <section aria-label="合併後的偏好">
        <h2>偏好</h2>
        {list(preferences)}
      </section>
      <section aria-label="我的本趟記憶">
        <h2>我的本趟記憶</h2>
        {view.own.length > 0 ? (
          <ul className="memory-list">
            {view.own.map((m) => (
              <li key={m.id}>
                <div className="memory-head">
                  <span className="memory-item">{m.item}</span>
                  <span className="muted">{KIND[m.kind]}</span>
                </div>
                <EditMemoryForm memory={m} />
              </li>
            ))}
          </ul>
        ) : null}
        <NewMemoryForm catalog={CONSTRAINT_CATALOG.map((c) => c.item)} tripId={tripId} />
      </section>
    </main>
  );
}
