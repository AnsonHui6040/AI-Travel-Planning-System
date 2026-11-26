import type { Metadata } from "next";
import { CONSTRAINT_CATALOG } from "@atps/memory";
import { loadOwnMemories, type OwnMemory } from "../../../lib/server/memories";
import { EditMemoryForm, NewMemoryForm, ProposalDecisionForm } from "./memory-forms";
import "../settings.css";
import "./memories.css";

// T41：記憶（第 5 節）。只顯示本人的記憶；可新增、修改、刪除（MEM-06）。旅後提案經本人批准後才寫入（MEM-03）

export const metadata: Metadata = { title: "記憶" };
export const dynamic = "force-dynamic";

const LAYERS: Array<{ layer: OwnMemory["layer"]; title: string; note: string }> = [
  { layer: "personal", title: "個人偏好", note: "每趟旅行都會用到" },
  { layer: "planning_rules", title: "Planning Rules", note: "安排行程時的規則，旅後提案批准後放在這裡" },
  { layer: "trip_context", title: "單趟旅行", note: "只用於該趟旅行，旅行結束後不帶入下一趟" },
];
const KIND: Record<string, string> = { constraint: "限制", preference: "偏好" };

export default async function MemoriesPage() {
  const { signedIn, memories, proposals } = await loadOwnMemories();
  if (!signedIn) {
    return (
      <main className="settings memories">
        <h1>記憶</h1>
        <p>請先登入。</p>
      </main>
    );
  }
  return (
    <main className="settings memories">
      <h1>記憶</h1>
      <p className="muted">
        記憶存在本系統，三家 AI 共用同一份。共同行程會合併所有成員的記憶，限制有衝突時取最保守值，不顯示是哪位成員。姓名、電話、電子郵件、地址與證件號碼不寫入記憶。
      </p>

      {proposals.length > 0 ? (
        <section aria-label="旅後記憶提案">
          <h2>待批准的旅後記憶提案</h2>
          <ul className="memory-list">
            {proposals.map((p) => (
              <li key={p.id}>
                <div className="memory-head">
                  <span className="memory-item">{p.item}</span>
                  <span>
                    {p.value}
                    {p.unit ? ` ${p.unit}` : ""}
                  </span>
                  <span className="muted">{p.tripName}</span>
                </div>
                <p className="muted">{p.reason}</p>
                <ProposalDecisionForm id={p.id} item={p.item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {LAYERS.map(({ layer, title, note }) => {
        const rows = memories.filter((m) => m.layer === layer);
        return (
          <section key={layer} aria-label={title}>
            <h2>{title}</h2>
            <p className="muted">{note}</p>
            {rows.length > 0 ? (
              <ul className="memory-list">
                {rows.map((m) => (
                  <li key={m.id}>
                    <div className="memory-head">
                      <span className="memory-item">{m.item}</span>
                      <span className="muted">{KIND[m.kind]}</span>
                      {m.tripName ? <span className="muted">{m.tripName}</span> : null}
                      {m.source === "post_trip_proposal" ? <span className="muted">旅後提案</span> : null}
                    </div>
                    <EditMemoryForm memory={m} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">沒有記憶。</p>
            )}
          </section>
        );
      })}

      <section aria-label="新增">
        <h2>新增記憶</h2>
        <p className="muted">清單內的限制（{CONSTRAINT_CATALOG.map((c) => c.item).join("、")}）會依固定單位比較；單趟旅行的記憶在各行程的「記憶」頁新增。</p>
        <NewMemoryForm catalog={CONSTRAINT_CATALOG.map((c) => c.item)} />
      </section>
    </main>
  );
}
