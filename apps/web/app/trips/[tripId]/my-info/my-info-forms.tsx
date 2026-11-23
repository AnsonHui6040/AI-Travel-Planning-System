"use client";

import { useActionState } from "react";
import { submitSensitiveField } from "./actions";

type Field = "full_name" | "phone" | "email";

interface OwnField {
  field: Field;
  value: string;
  sharing: { ai: boolean; members: boolean; viewers: boolean };
}

const FIELDS: { id: Field; label: string; type: string; autoComplete: string; maxLength: number }[] = [
  { id: "full_name", label: "全名", type: "text", autoComplete: "name", maxLength: 80 },
  { id: "phone", label: "電話", type: "tel", autoComplete: "tel", maxLength: 25 },
  { id: "email", label: "電子郵件", type: "email", autoComplete: "email", maxLength: 254 },
];

const TOGGLES: { name: string; key: keyof OwnField["sharing"]; label: string }[] = [
  { name: "share_ai", key: "ai", label: "提供給 AI" },
  { name: "share_members", key: "members", label: "提供給其他成員" },
  { name: "share_viewers", key: "viewers", label: "提供給 Viewer 與唯讀連結" },
];

export function MyInfoForms({ tripId, own }: { tripId: string; own: OwnField[] }) {
  const [state, action, pending] = useActionState(submitSensitiveField, null);

  return (
    <>
      <p role="status" aria-live="polite" className={state && !state.ok ? "status error" : "status"}>
        {state?.message ?? ""}
      </p>
      {FIELDS.map((f) => {
        const saved = own.find((o) => o.field === f.id);
        const inputId = `value-${f.id}`;
        return (
          // key 含目前的值與開關，儲存後重新載入時表單顯示最新狀態
          <form key={`${f.id}:${saved?.value ?? ""}:${JSON.stringify(saved?.sharing ?? null)}`} action={action} className="key-row">
            <fieldset disabled={pending}>
              <legend>{f.label}</legend>
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="field" value={f.id} />
              <label htmlFor={inputId}>{f.label}</label>
              <input
                id={inputId}
                name="value"
                type={f.type}
                autoComplete={f.autoComplete}
                maxLength={f.maxLength}
                defaultValue={saved?.value ?? ""}
              />
              <div className="toggles">
                {TOGGLES.map((t) => (
                  <label key={t.name} className="toggle">
                    <input type="checkbox" name={t.name} defaultChecked={saved?.sharing[t.key] ?? false} />
                    {t.label}
                  </label>
                ))}
              </div>
              <div className="key-actions">
                <button type="submit" name="intent" value="save">
                  儲存
                </button>
              </div>
            </fieldset>
          </form>
        );
      })}
    </>
  );
}
