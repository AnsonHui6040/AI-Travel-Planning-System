import {
  AI_PROVIDERS,
  AI_ROLES,
  PROVIDER_NAMES,
  ROLE_NAMES,
  validateRoleSetting,
  type AiProvider,
  type AiRole,
  type ChainEntry,
  type RoleSetting,
} from "@atps/core";

// T14：AI 角色設定頁的 Server Action 邏輯。擁有者一律取自 session（C-05）；訊息不含 key（C-04）。

export interface AiSettingsDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  saveSetting: (ownerId: string, setting: RoleSetting) => Promise<void>;
  // 只解密請求者本人的 key
  decryptOwnKey: (provider: AiProvider) => Promise<string | null>;
  listModels: (provider: AiProvider, apiKey: string) => Promise<string[]>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface ModelListResult extends ActionResult {
  provider?: AiProvider;
  models?: string[];
}

const RATE = { endpoint: "ai_settings.write", limit: 20, windowSeconds: 60 } as const;
const SLOTS = 3;

const isRole = (v: unknown): v is AiRole => typeof v === "string" && (AI_ROLES as readonly string[]).includes(v);
const isProvider = (v: unknown): v is AiProvider =>
  typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);

export function parseRoleSettingForm(form: FormData): RoleSetting | null {
  const role = form.get("role");
  if (!isRole(role)) return null;
  const chain: ChainEntry[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const provider = form.get(`provider_${i}`);
    if (provider === null || provider === "") continue;
    if (!isProvider(provider)) return null;
    const model = form.get(`model_${i}`);
    const trimmed = typeof model === "string" ? model.trim() : "";
    chain.push({ provider, model: trimmed === "" ? null : trimmed });
  }
  return {
    role,
    chain,
    maxSteps: Number(form.get("max_steps")),
    maxTokens: Number(form.get("max_tokens")),
  };
}

async function authorize(deps: AiSettingsDeps): Promise<{ id: string } | ActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) {
    return { ok: false, message: "操作過於頻繁，請稍後再試" };
  }
  return user;
}

export async function saveRoleSettingAction(deps: AiSettingsDeps, form: FormData): Promise<ActionResult> {
  const user = await authorize(deps);
  if ("ok" in user) return user;
  const setting = parseRoleSettingForm(form);
  if (!setting) return { ok: false, message: "設定內容不正確" };
  const issues = validateRoleSetting(setting);
  if (issues.length > 0) return { ok: false, message: issues.join("；") };
  try {
    await deps.saveSetting(user.id, setting);
    return { ok: true, message: `已儲存 ${ROLE_NAMES[setting.role]} 的設定` };
  } catch {
    return { ok: false, message: "儲存失敗，請稍後再試" };
  }
}

export async function listModelsAction(deps: AiSettingsDeps, form: FormData): Promise<ModelListResult> {
  const user = await authorize(deps);
  if ("ok" in user) return user;
  const provider = form.get("provider");
  if (!isProvider(provider)) return { ok: false, message: "不支援的服務" };
  const name = PROVIDER_NAMES[provider];
  const apiKey = await deps.decryptOwnKey(provider);
  if (!apiKey) return { ok: false, provider, message: `請先在 API key 設定頁設定 ${name} 的 key` };
  try {
    const models = [...(await deps.listModels(provider, apiKey))].sort();
    return { ok: true, provider, models, message: `已取得 ${models.length} 個 ${name} 模型` };
  } catch {
    return { ok: false, provider, message: "無法取得模型清單，請稍後再試" };
  }
}
