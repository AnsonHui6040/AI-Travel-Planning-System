"use client";

import { useActionState, useState } from "react";
import type { ModelListResult } from "../../../lib/server/ai-settings-core";
import { submitAiSettings } from "./actions";

type Provider = "anthropic" | "google" | "openai";
type Role = "research" | "verification" | "transport" | "master_planner" | "live_planner";

interface Setting {
  role: Role;
  chain: { provider: Provider; model: string | null }[];
  maxSteps: number;
  maxTokens: number;
}

const PROVIDERS: { id: Provider; name: string }[] = [
  { id: "anthropic", name: "Claude" },
  { id: "google", name: "Gemini" },
  { id: "openai", name: "OpenAI" },
];

const ROLES: Record<Role, { name: string; use: string }> = {
  research: { name: "Research", use: "找候選地點，可用供應商內建搜尋" },
  verification: { name: "Verification", use: "核實營業時間、門票與休館，可讀白名單官方網站" },
  transport: { name: "Transport", use: "估算各段交通，可用交通狀態資料" },
  master_planner: { name: "Master Planner", use: "排行程並提出變更提案，沒有網路工具" },
  live_planner: { name: "Live Planner", use: "旅行當天重算受影響的範圍，沒有網路工具" },
};

const SLOTS = [0, 1, 2] as const;

export function AiSettingsForms({ settings }: { settings: Setting[] }) {
  const [models, setModels] = useState<Partial<Record<Provider, string[]>>>({});
  const [state, action, pending] = useActionState(
    async (previous: ModelListResult | null, form: FormData) => {
      const result = await submitAiSettings(previous, form);
      const { provider, models: list } = result;
      if (provider && list) setModels((current) => ({ ...current, [provider]: list }));
      return result;
    },
    null,
  );

  return (
    <>
      <p role="status" aria-live="polite" className={state && !state.ok ? "status error" : "status"}>
        {state?.message ?? ""}
      </p>

      <div className="model-lists">
        {PROVIDERS.map((p) => (
          <form key={p.id} action={action}>
            <input type="hidden" name="intent" value="models" />
            <input type="hidden" name="provider" value={p.id} />
            <button type="submit" disabled={pending}>
              取得 {p.name} 模型清單
            </button>
          </form>
        ))}
      </div>
      {PROVIDERS.map((p) => (
        <datalist key={p.id} id={`models-${p.id}`}>
          {(models[p.id] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ))}

      {settings.map((s) => {
        const role = ROLES[s.role];
        return (
          <form key={s.role} action={action} className="key-row">
            <fieldset disabled={pending}>
              <legend>{role.name}</legend>
              <p className="key-use">{role.use}</p>
              <input type="hidden" name="intent" value="save" />
              <input type="hidden" name="role" value={s.role} />
              {SLOTS.map((i) => {
                const entry = s.chain[i];
                return (
                  <div key={i} className="chain-row">
                    <label htmlFor={`${s.role}-provider-${i}`}>第 {i + 1} 順位供應商</label>
                    <select id={`${s.role}-provider-${i}`} name={`provider_${i}`} defaultValue={entry?.provider ?? ""}>
                      <option value="">不使用</option>
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={`${s.role}-model-${i}`}>第 {i + 1} 順位模型</label>
                    <input
                      id={`${s.role}-model-${i}`}
                      name={`model_${i}`}
                      defaultValue={entry?.model ?? ""}
                      list={entry ? `models-${entry.provider}` : undefined}
                      maxLength={100}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                );
              })}
              <div className="limits">
                <label htmlFor={`${s.role}-steps`}>步數上限</label>
                <input id={`${s.role}-steps`} name="max_steps" type="number" inputMode="numeric" defaultValue={s.maxSteps} />
                <label htmlFor={`${s.role}-tokens`}>token 上限</label>
                <input id={`${s.role}-tokens`} name="max_tokens" type="number" inputMode="numeric" defaultValue={s.maxTokens} />
              </div>
              <div className="key-actions">
                <button type="submit" value="save">
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
