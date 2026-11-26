"use client";

import { checkBaseline, classifyBaseline } from "@atps/core";
import { tripBaselineData, type TripBaselineData } from "@atps/schemas";
import { useActionState, useMemo, useState } from "react";
import { confirmBaseline, saveBaseline } from "./actions";
import { ConstraintGroups, IssueList } from "./baseline-summary";

// T23：旅行基線表單。限制分類與矛盾檢查在輸入時即時顯示；儲存與確認時伺服器重新檢查

const OFFSETS = [
  "-10:00", "-08:00", "-07:00", "-05:00", "-04:00", "-03:00", "+00:00", "+01:00", "+02:00", "+03:00", "+04:00",
  "+05:30", "+07:00", "+08:00", "+09:00", "+09:30", "+10:00", "+11:00", "+12:00", "+13:00",
];
const TRANSPORT: { id: TripBaselineData["transport_preferences"][number]; label: string }[] = [
  { id: "rail", label: "鐵路" },
  { id: "walk", label: "步行" },
  { id: "bus", label: "公車" },
  { id: "taxi", label: "計程車" },
  { id: "drive", label: "自駕" },
];

interface FlightRow { key: number; label: string; depLocal: string; depOffset: string; arrLocal: string; arrOffset: string }
interface LodgingRow { key: number; name: string; area: string; checkIn: string; checkOut: string; checkInTime: string }
interface ActivityRow { key: number; name: string; area: string; date: string; start: string; end: string; paid: boolean }
interface FormState {
  start: string;
  end: string;
  timezone: string;
  companions: string;
  flights: FlightRow[];
  lodgings: LodgingRow[];
  activities: ActivityRow[];
  paidItems: string;
  mustVisit: string;
  excluded: string;
  stamina: string;
  budgetAmount: string;
  budgetCurrency: string;
  transport: string[];
  photography: string;
}

let nextKey = 1;
const key = () => nextKey++;

function splitOffset(value: string): [string, string] {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return ["", "+09:00"];
  return [m[1] ?? "", m[2] === "Z" ? "+00:00" : (m[2] ?? "+09:00")];
}

function fromBaseline(b: TripBaselineData | null): FormState {
  return {
    start: b?.start_date ?? "",
    end: b?.end_date ?? "",
    timezone: b?.timezone ?? "Asia/Tokyo",
    companions: String(b?.companions ?? 0),
    flights: (b?.flights ?? []).map((f) => {
      const [depLocal, depOffset] = splitOffset(f.departs_at);
      const [arrLocal, arrOffset] = splitOffset(f.arrives_at);
      return { key: key(), label: f.label, depLocal, depOffset, arrLocal, arrOffset };
    }),
    lodgings: (b?.lodgings ?? []).map((l) => ({
      key: key(),
      name: l.name,
      area: l.area ?? "",
      checkIn: l.check_in,
      checkOut: l.check_out,
      checkInTime: l.check_in_time ?? "",
    })),
    activities: (b?.fixed_activities ?? []).map((a) => ({
      key: key(),
      name: a.name,
      area: a.area ?? "",
      date: a.date,
      start: a.start,
      end: a.end ?? "",
      paid: a.paid,
    })),
    paidItems: (b?.paid_items ?? []).join("\n"),
    mustVisit: (b?.must_visit ?? []).join("\n"),
    excluded: (b?.excluded ?? []).join("\n"),
    stamina: b?.stamina_note ?? "",
    budgetAmount: b?.budget ? String(b.budget.amount) : "",
    budgetCurrency: b?.budget?.currency ?? "TWD",
    transport: [...(b?.transport_preferences ?? [])],
    photography: b?.photography_needs ?? "",
  };
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

function toBaseline(s: FormState): unknown {
  return {
    start_date: s.start,
    end_date: s.end,
    timezone: s.timezone.trim(),
    flights: s.flights.map((f) => ({
      label: f.label.trim(),
      departs_at: f.depLocal ? `${f.depLocal}:00${f.depOffset}` : "",
      arrives_at: f.arrLocal ? `${f.arrLocal}:00${f.arrOffset}` : "",
    })),
    lodgings: s.lodgings.map((l) => ({
      name: l.name.trim(),
      area: orNull(l.area),
      check_in: l.checkIn,
      check_out: l.checkOut,
      check_in_time: orNull(l.checkInTime),
    })),
    companions: Number(s.companions),
    stamina_note: orNull(s.stamina),
    budget: s.budgetAmount.trim() === "" ? null : { amount: Number(s.budgetAmount), currency: s.budgetCurrency.trim().toUpperCase() },
    fixed_activities: s.activities.map((a) => ({
      name: a.name.trim(),
      area: orNull(a.area),
      date: a.date,
      start: a.start,
      end: orNull(a.end),
      paid: a.paid,
    })),
    paid_items: lines(s.paidItems),
    must_visit: lines(s.mustVisit),
    excluded: lines(s.excluded),
    transport_preferences: TRANSPORT.map((t) => t.id).filter((id) => s.transport.includes(id)),
    photography_needs: orNull(s.photography),
  };
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function BaselineForm({ tripId, saved }: { tripId: string; saved: TripBaselineData | null }) {
  const [state, setState] = useState<FormState>(() => fromBaseline(saved));
  const [saveState, saveAction, saving] = useActionState(saveBaseline, null);
  const [confirmState, confirmAction, confirming] = useActionState(confirmBaseline, null);

  const raw = useMemo(() => toBaseline(state), [state]);
  const json = JSON.stringify(raw);
  const parsed = useMemo(() => tripBaselineData.safeParse(raw), [raw]);
  const checked = parsed.success ? { constraints: classifyBaseline(parsed.data), issues: checkBaseline(parsed.data) } : null;
  const dirty = saved === null || json !== JSON.stringify(toBaseline(fromBaseline(saved)));
  const conflicts = checked?.issues.filter((i) => i.severity === "conflict").length ?? 0;
  const status = confirmState ?? saveState;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setState((s) => ({ ...s, [k]: v }));
  const update = <K extends "flights" | "lodgings" | "activities">(k: K, rowKey: number, patch: Partial<FormState[K][number]>) =>
    setState((s) => ({ ...s, [k]: (s[k] as Array<{ key: number }>).map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) }));
  const remove = (k: "flights" | "lodgings" | "activities", rowKey: number) =>
    setState((s) => ({ ...s, [k]: (s[k] as Array<{ key: number }>).filter((r) => r.key !== rowKey) }));

  return (
    <div className="baseline-layout">
      {/* 輸入欄位不放在 form 內：React 在 Server Action 完成後會重設 form，受控的核取方塊會與狀態不一致 */}
      <div className="baseline-form" role="group" aria-label="旅行基線">
        <fieldset disabled={saving || confirming}>
          <section aria-labelledby="dates-heading">
            <h2 id="dates-heading">日期與同行者</h2>
            <div className="grid-2">
              <Field id="start" label="開始日期">
                <input id="start" type="date" value={state.start} onChange={(e) => set("start", e.target.value)} required />
              </Field>
              <Field id="end" label="結束日期">
                <input id="end" type="date" value={state.end} onChange={(e) => set("end", e.target.value)} required />
              </Field>
              <Field id="timezone" label="目的地時區（IANA）">
                <input id="timezone" value={state.timezone} onChange={(e) => set("timezone", e.target.value)} maxLength={60} required />
              </Field>
              <Field id="companions" label="同行者人數（不含自己）">
                <input id="companions" type="number" min={0} max={20} value={state.companions} onChange={(e) => set("companions", e.target.value)} />
              </Field>
            </div>
          </section>

          <section aria-labelledby="flights-heading">
            <h2 id="flights-heading">航班</h2>
            {state.flights.map((f, i) => (
              <div key={f.key} className="row-card" role="group" aria-label={`航班 ${i + 1}`}>
                <Field id={`f-label-${f.key}`} label="航班名稱">
                  <input id={`f-label-${f.key}`} value={f.label} maxLength={80} onChange={(e) => update("flights", f.key, { label: e.target.value })} />
                </Field>
                <div className="grid-2">
                  <Field id={`f-dep-${f.key}`} label="出發（當地時間）">
                    <input id={`f-dep-${f.key}`} type="datetime-local" value={f.depLocal} onChange={(e) => update("flights", f.key, { depLocal: e.target.value })} />
                  </Field>
                  <Field id={`f-depo-${f.key}`} label="出發地時差">
                    <select id={`f-depo-${f.key}`} value={f.depOffset} onChange={(e) => update("flights", f.key, { depOffset: e.target.value })}>
                      {OFFSETS.map((o) => (
                        <option key={o} value={o}>UTC{o}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`f-arr-${f.key}`} label="抵達（當地時間）">
                    <input id={`f-arr-${f.key}`} type="datetime-local" value={f.arrLocal} onChange={(e) => update("flights", f.key, { arrLocal: e.target.value })} />
                  </Field>
                  <Field id={`f-arro-${f.key}`} label="抵達地時差">
                    <select id={`f-arro-${f.key}`} value={f.arrOffset} onChange={(e) => update("flights", f.key, { arrOffset: e.target.value })}>
                      {OFFSETS.map((o) => (
                        <option key={o} value={o}>UTC{o}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button className="danger" type="button" onClick={() => remove("flights", f.key)}>刪除航班 {i + 1}</button>
              </div>
            ))}
            <button className="secondary"
              type="button"
              onClick={() => set("flights", [...state.flights, { key: key(), label: "", depLocal: "", depOffset: "+08:00", arrLocal: "", arrOffset: "+09:00" }])}
            >
              新增航班
            </button>
          </section>

          <section aria-labelledby="lodgings-heading">
            <h2 id="lodgings-heading">住宿</h2>
            {state.lodgings.map((l, i) => (
              <div key={l.key} className="row-card" role="group" aria-label={`住宿 ${i + 1}`}>
                <div className="grid-2">
                  <Field id={`l-name-${l.key}`} label="名稱">
                    <input id={`l-name-${l.key}`} value={l.name} maxLength={120} onChange={(e) => update("lodgings", l.key, { name: e.target.value })} />
                  </Field>
                  <Field id={`l-area-${l.key}`} label="地區">
                    <input id={`l-area-${l.key}`} value={l.area} maxLength={80} onChange={(e) => update("lodgings", l.key, { area: e.target.value })} />
                  </Field>
                  <Field id={`l-in-${l.key}`} label="入住日期">
                    <input id={`l-in-${l.key}`} type="date" value={l.checkIn} onChange={(e) => update("lodgings", l.key, { checkIn: e.target.value })} />
                  </Field>
                  <Field id={`l-out-${l.key}`} label="退房日期">
                    <input id={`l-out-${l.key}`} type="date" value={l.checkOut} onChange={(e) => update("lodgings", l.key, { checkOut: e.target.value })} />
                  </Field>
                  <Field id={`l-time-${l.key}`} label="入住時間（選填）">
                    <input id={`l-time-${l.key}`} type="time" value={l.checkInTime} onChange={(e) => update("lodgings", l.key, { checkInTime: e.target.value })} />
                  </Field>
                </div>
                <button className="danger" type="button" onClick={() => remove("lodgings", l.key)}>刪除住宿 {i + 1}</button>
              </div>
            ))}
            <button className="secondary"
              type="button"
              onClick={() => set("lodgings", [...state.lodgings, { key: key(), name: "", area: "", checkIn: state.start, checkOut: state.end, checkInTime: "" }])}
            >
              新增住宿
            </button>
          </section>

          <section aria-labelledby="activities-heading">
            <h2 id="activities-heading">固定活動</h2>
            {state.activities.map((a, i) => (
              <div key={a.key} className="row-card" role="group" aria-label={`固定活動 ${i + 1}`}>
                <div className="grid-2">
                  <Field id={`a-name-${a.key}`} label="名稱">
                    <input id={`a-name-${a.key}`} value={a.name} maxLength={80} onChange={(e) => update("activities", a.key, { name: e.target.value })} />
                  </Field>
                  <Field id={`a-area-${a.key}`} label="地區">
                    <input id={`a-area-${a.key}`} value={a.area} maxLength={80} onChange={(e) => update("activities", a.key, { area: e.target.value })} />
                  </Field>
                  <Field id={`a-date-${a.key}`} label="日期">
                    <input id={`a-date-${a.key}`} type="date" value={a.date} onChange={(e) => update("activities", a.key, { date: e.target.value })} />
                  </Field>
                  <Field id={`a-start-${a.key}`} label="開始時間">
                    <input id={`a-start-${a.key}`} type="time" value={a.start} onChange={(e) => update("activities", a.key, { start: e.target.value })} />
                  </Field>
                  <Field id={`a-end-${a.key}`} label="結束時間（選填）">
                    <input id={`a-end-${a.key}`} type="time" value={a.end} onChange={(e) => update("activities", a.key, { end: e.target.value })} />
                  </Field>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={a.paid} onChange={(e) => update("activities", a.key, { paid: e.target.checked })} />
                  已付款
                </label>
                <button className="danger" type="button" onClick={() => remove("activities", a.key)}>刪除固定活動 {i + 1}</button>
              </div>
            ))}
            <button className="secondary"
              type="button"
              onClick={() => set("activities", [...state.activities, { key: key(), name: "", area: "", date: state.start, start: "", end: "", paid: false }])}
            >
              新增固定活動
            </button>
          </section>

          <section aria-labelledby="places-heading">
            <h2 id="places-heading">地點與已付款項目</h2>
            <Field id="must" label="必去地點（每行一個）">
              <textarea id="must" rows={3} value={state.mustVisit} onChange={(e) => set("mustVisit", e.target.value)} />
            </Field>
            <Field id="excluded" label="排除地點（每行一個）">
              <textarea id="excluded" rows={3} value={state.excluded} onChange={(e) => set("excluded", e.target.value)} />
            </Field>
            <Field id="paid" label="已付款項目（每行一個，例如票券、交通周遊券）">
              <textarea id="paid" rows={3} value={state.paidItems} onChange={(e) => set("paidItems", e.target.value)} />
            </Field>
          </section>

          <section aria-labelledby="prefs-heading">
            <h2 id="prefs-heading">體力、預算與偏好</h2>
            <Field id="stamina" label="體力限制（選填）">
              <textarea id="stamina" rows={2} maxLength={300} value={state.stamina} onChange={(e) => set("stamina", e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field id="budget" label="預算（選填）">
                <input id="budget" type="number" min={0} inputMode="numeric" value={state.budgetAmount} onChange={(e) => set("budgetAmount", e.target.value)} />
              </Field>
              <Field id="currency" label="幣別">
                <input id="currency" value={state.budgetCurrency} maxLength={3} onChange={(e) => set("budgetCurrency", e.target.value)} />
              </Field>
            </div>
            <fieldset className="choices">
              <legend>交通偏好</legend>
              {TRANSPORT.map((t) => (
                <label key={t.id} className="toggle">
                  <input
                    type="checkbox"
                    checked={state.transport.includes(t.id)}
                    onChange={(e) => set("transport", e.target.checked ? [...state.transport, t.id] : state.transport.filter((x) => x !== t.id))}
                  />
                  {t.label}
                </label>
              ))}
            </fieldset>
            <Field id="photo" label="攝影需求（選填）">
              <textarea id="photo" rows={2} maxLength={300} value={state.photography} onChange={(e) => set("photography", e.target.value)} />
            </Field>
          </section>

          <form action={saveAction} className="key-actions sticky-actions">
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="data" value={json} />
            <button className="secondary" type="submit" name="intent" value="save">
              儲存草稿
            </button>
          </form>
        </fieldset>
      </div>

      <aside className="baseline-side" aria-label="檢查結果">
        <p role="status" aria-live="polite" className={status && !status.ok ? "status error" : "status"}>
          {status?.message ?? ""}
        </p>
        {checked ? (
          <>
            <IssueList issues={checked.issues} />
            <ConstraintGroups constraints={checked.constraints} />
          </>
        ) : (
          <p className="muted">填寫日期與各列必填欄位後顯示限制分類與矛盾檢查。</p>
        )}
        <form action={confirmAction} className="confirm-form">
          <input type="hidden" name="tripId" value={tripId} />
          <button className="primary" type="submit" name="intent" value="save" disabled={dirty || conflicts > 0 || !checked || saving || confirming}>
            確認 Trip Baseline v1
          </button>
          <p className="muted">
            {dirty ? "儲存草稿後才能確認。" : conflicts > 0 ? "處理所有矛盾後才能確認。" : "確認後行程進入規劃中，之後的修改改為提出變更提案。"}
          </p>
        </form>
      </aside>
    </div>
  );
}
