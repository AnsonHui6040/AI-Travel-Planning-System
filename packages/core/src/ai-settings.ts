import { enums } from "@atps/schemas";
import { ROLE_LIMITS } from "./extensions";

// T14：每個角色的模型與備援次序（D06、C-08）、上限（S-06）、同一家警告（D07）。預設值見決策 0006。

export const AI_ROLES = enums.aiRole.options;
export type AiRole = (typeof AI_ROLES)[number];
export const AI_PROVIDERS = enums.aiProvider.options;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Claude",
  google: "Gemini",
  openai: "OpenAI",
};

export const ROLE_NAMES: Record<AiRole, string> = {
  research: "Research",
  verification: "Verification",
  transport: "Transport",
  master_planner: "Master Planner",
  live_planner: "Live Planner",
};

export interface ChainEntry {
  provider: AiProvider;
  // null：尚未選擇模型，該順位不可使用
  model: string | null;
}

export interface RoleSetting {
  role: AiRole;
  chain: ChainEntry[];
  maxSteps: number;
  maxTokens: number;
}

const DEFAULT_MODELS: Record<AiProvider, string | null> = {
  anthropic: "claude-opus-5-5",
  google: null,
  openai: null,
};

const ORDER: Record<"default" | "verification", AiProvider[]> = {
  default: ["anthropic", "google", "openai"],
  verification: ["google", "openai", "anthropic"],
};

const LIMITS: Record<AiRole, { maxSteps: number; maxTokens: number }> = {
  research: { maxSteps: 6, maxTokens: 200_000 },
  verification: { maxSteps: 10, maxTokens: 200_000 },
  transport: { maxSteps: 6, maxTokens: 120_000 },
  master_planner: { maxSteps: 4, maxTokens: 150_000 },
  live_planner: { maxSteps: 3, maxTokens: 60_000 },
};

export function defaultRoleSetting(role: AiRole): RoleSetting {
  const order = role === "verification" ? ORDER.verification : ORDER.default;
  return {
    role,
    chain: order.map((provider) => ({ provider, model: DEFAULT_MODELS[provider] })),
    ...LIMITS[role],
  };
}

export const DEFAULT_ROLE_SETTINGS: readonly RoleSetting[] = AI_ROLES.map(defaultRoleSetting);

export const MIN_ROLE_TOKENS = 1_000;
const MODEL = /^[A-Za-z0-9._:/-]{1,100}$/;

export function validateRoleSetting(setting: RoleSetting): string[] {
  const issues: string[] = [];
  if (!(AI_ROLES as readonly string[]).includes(setting.role)) issues.push("不認識的角色");
  const { maxSteps, maxTokens } = setting;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > ROLE_LIMITS.maxSteps) {
    issues.push(`步數上限必須是 1 至 ${ROLE_LIMITS.maxSteps} 的整數`);
  }
  if (!Number.isInteger(maxTokens) || maxTokens < MIN_ROLE_TOKENS || maxTokens > ROLE_LIMITS.maxTokens) {
    issues.push(`token 上限必須是 ${MIN_ROLE_TOKENS.toLocaleString("en-US")} 至 ${ROLE_LIMITS.maxTokens.toLocaleString("en-US")} 的整數`);
  }
  if (setting.chain.length < 1 || setting.chain.length > AI_PROVIDERS.length) issues.push("備援次序須有 1 至 3 家");
  const providers = setting.chain.map((c) => c.provider);
  if (new Set(providers).size !== providers.length) issues.push("備援次序中同一家只能出現一次");
  for (const entry of setting.chain) {
    if (!(AI_PROVIDERS as readonly string[]).includes(entry.provider)) issues.push("不認識的供應商");
    if (entry.model !== null && !MODEL.test(entry.model)) issues.push("模型名稱只可使用英數與 . _ - : /，最多 100 字元");
  }
  return issues;
}

const SAME_PROVIDER = "Research 與 Verification 使用同一家 AI，核實結果最高為 Partially Verified";

// D07：設定頁警告
export function sameProviderWarning(settings: readonly RoleSetting[]): string | null {
  const primary = (role: AiRole) => settings.find((s) => s.role === role)?.chain[0]?.provider;
  const research = primary("research");
  return research !== undefined && research === primary("verification") ? SAME_PROVIDER : null;
}

// D07：依實際執行的供應商決定核實上限（備援切換後也適用）
export function verificationCap(researchProvider: AiProvider, verificationProvider: AiProvider): "verified" | "partially_verified" {
  return researchProvider === verificationProvider ? "partially_verified" : "verified";
}
