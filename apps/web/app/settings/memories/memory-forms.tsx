"use client";

import { useActionState } from "react";
import { decideProposal, deleteMemory, generateProposals, saveMemory } from "./actions";

// T41：記憶的表單。欄位都不受控（React 19 在 Server Action 後會重設表單）

type Result = { ok: boolean; message: string } | null;

function Status({ state }: { state: Result }) {
  return state ? (
    <p role="status" className={state.ok ? "ok" : "error"}>
      {state.message}
    </p>
  ) : null;
}

export function NewMemoryForm({ catalog, tripId }: { catalog: string[]; tripId?: string }) {
  const [state, action, pending] = useActionState(saveMemory, null);
  const listId = tripId ? `memory-items-${tripId}` : "memory-items";
  return (
    <form action={action} className="memory-form" aria-label="新增記憶">
      {tripId ? (
        <>
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="layer" value="trip_context" />
        </>
      ) : (
        <label>
          層級
          <select name="layer" defaultValue="personal">
            <option value="personal">個人偏好</option>
            <option value="planning_rules">Planning Rules</option>
          </select>
        </label>
      )}
      <label>
        類型
        <select name="kind" defaultValue="constraint">
          <option value="constraint">限制</option>
          <option value="preference">偏好</option>
        </select>
      </label>
      <label>
        項目
        <input name="item" list={listId} maxLength={80} required />
        <datalist id={listId}>
          {catalog.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label>
        內容
        <input name="value" maxLength={200} required />
      </label>
      <label>
        單位（可留空）
        <input name="unit" maxLength={20} />
      </label>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "儲存中…" : "新增"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function EditMemoryForm({ memory }: { memory: { id: string; layer: string; kind: string; item: string; value: string; unit: string | null; tripId: string | null } }) {
  const [state, action, pending] = useActionState(saveMemory, null);
  const [delState, del, deleting] = useActionState(deleteMemory, null);
  return (
    <div className="memory-edit">
      <form action={action} aria-label={`修改 ${memory.item}`}>
        <input type="hidden" name="id" value={memory.id} />
        <input type="hidden" name="layer" value={memory.layer} />
        <input type="hidden" name="kind" value={memory.kind} />
        <input type="hidden" name="item" value={memory.item} />
        <input type="hidden" name="tripId" value={memory.tripId ?? ""} />
        <label>
          內容
          <input name="value" defaultValue={memory.value} maxLength={200} required />
        </label>
        <label>
          單位
          <input name="unit" defaultValue={memory.unit ?? ""} maxLength={20} />
        </label>
        <button className="secondary" type="submit" disabled={pending}>
          儲存
        </button>
        <Status state={state} />
      </form>
      <form
        action={del}
        aria-label={`刪除 ${memory.item}`}
        onSubmit={(event) => {
          if (!window.confirm(`刪除「${memory.item}」？刪除後 AI 不會再使用，無法復原。`)) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={memory.id} />
        <input type="hidden" name="tripId" value={memory.tripId ?? ""} />
        <button className="danger" type="submit" disabled={deleting}>
          刪除
        </button>
        <Status state={delState} />
      </form>
    </div>
  );
}

export function ProposalDecisionForm({ id, item }: { id: string; item: string }) {
  const [state, action, pending] = useActionState(decideProposal, null);
  return (
    <form
      action={action}
      className="memory-decision"
      aria-label={`決定 ${item}`}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === "reject" && !window.confirm(`否決「${item}」？否決後不會寫入記憶。`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="secondary" type="submit" name="decision" value="approve" disabled={pending}>
        批准
      </button>
      <button className="danger" type="submit" name="decision" value="reject" disabled={pending}>
        否決
      </button>
      <Status state={state} />
    </form>
  );
}

export function GenerateProposalsForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(generateProposals, null);
  return (
    <form action={action} className="memory-generate">
      <input type="hidden" name="tripId" value={tripId} />
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "產生中…" : "產生旅後記憶提案"}
      </button>
      <Status state={state} />
    </form>
  );
}
