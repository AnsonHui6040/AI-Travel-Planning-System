"use client";

import { useActionState } from "react";
import { submitApiKey } from "./actions";

type Provider = "anthropic" | "google_ai" | "openai" | "google_maps" | "odpt";

const PROVIDERS: { id: Provider; name: string; use: string }[] = [
  { id: "anthropic", name: "Anthropic Claude", use: "AI 規劃與研究" },
  { id: "google_ai", name: "Google Gemini", use: "AI 規劃與研究" },
  { id: "openai", name: "OpenAI", use: "AI 規劃與研究" },
  { id: "google_maps", name: "Google Maps Platform", use: "地點、路線與照片" },
  { id: "odpt", name: "ODPT", use: "日本公共交通運行情報" },
];

interface KeySummary {
  provider: Provider;
  last4: string;
  lastTestedAt: string | null;
}

export function ApiKeyForms({ keys }: { keys: KeySummary[] }) {
  const [state, action, pending] = useActionState(submitApiKey, null);

  return (
    <>
      <p role="status" aria-live="polite" className={state && !state.ok ? "status error" : "status"}>
        {state?.message ?? ""}
      </p>
      {PROVIDERS.map((p) => {
        const saved = keys.find((k) => k.provider === p.id);
        const inputId = `key-${p.id}`;
        return (
          <form key={p.id} action={action} className="key-row">
            <fieldset disabled={pending}>
              <legend>{p.name}</legend>
              <p className="key-use">{p.use}</p>
              <p className="key-current">
                {saved ? (
                  <>
                    目前：<span>••••{saved.last4}</span>
                    {saved.lastTestedAt ? "" : "（尚未測試）"}
                  </>
                ) : (
                  "尚未設定"
                )}
              </p>
              <input type="hidden" name="provider" value={p.id} />
              <label htmlFor={inputId}>新的 {p.name} key</label>
              <input
                id={inputId}
                name="secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={512}
              />
              <div className="key-actions">
                <button type="submit" name="intent" value="save">
                  儲存
                </button>
                {saved ? (
                  <button type="submit" name="intent" value="delete" formNoValidate>
                    刪除
                  </button>
                ) : null}
              </div>
            </fieldset>
          </form>
        );
      })}
    </>
  );
}
