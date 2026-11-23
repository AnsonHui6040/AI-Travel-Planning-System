import { enums, type Row } from "@atps/schemas";

type Memory = Row<"memories">;

// 第 2.3 節五個擴充點的介面與共用契約檢查。檢查函式回傳問題清單，空陣列表示通過。
// 註冊表在註冊時執行檢查（registry.ts），各套件的註冊表見 packages/ai、data-sources、regions。

const ID = /^[a-z][a-z0-9_-]{0,62}$/;
const REGION_ID = /^[A-Z]{2}$/;
const HOST =/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function duplicates(values: readonly string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

function unknownValues(values: readonly string[], allowed: readonly string[]): string[] {
  return values.filter((v) => !allowed.includes(v));
}

function checkList(label: string, values: readonly string[], allowed: readonly string[]): string[] {
  const issues: string[] = [];
  const unknown = unknownValues(values, allowed);
  if (unknown.length > 0) issues.push(`${label}含未定義的值：${unknown.join("、")}`);
  const dup = duplicates(values);
  if (dup.length > 0) issues.push(`${label}重複：${dup.join("、")}`);
  return issues;
}

function checkId(id: string): string[] {
  return ID.test(id) ? [] : ["id 只可使用小寫英文、數字、底線與連字號，且以英文開頭"];
}

// ── 認證方式 ──────────────────────────────────────────────

export const CREDENTIAL_KINDS = ["api_key", "plan_oauth"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

// 憑證只在伺服器內傳遞，不寫入記錄或回應（C-02）
export interface Credential {
  kind: CredentialKind;
  secret: string;
}

export interface CredentialProvider {
  kind: CredentialKind;
  // plan_oauth 第一版預留，available 為 false
  available: boolean;
  // 依 D15 只取用請求者本人的憑證；沒有時回傳 null
  resolve(request: { ownerId: string; provider: string }): Promise<Credential | null>;
}

export function checkCredentialProvider(provider: CredentialProvider): string[] {
  const issues = checkList("認證方式", [provider.kind], CREDENTIAL_KINDS);
  if (typeof provider.available !== "boolean") issues.push("available 必須是布林值");
  if (typeof provider.resolve !== "function") issues.push("缺少 resolve");
  return issues;
}

// ── AI provider ──────────────────────────────────────────

// T13 的錯誤分類：逾時、限流、中斷、驗證失敗；其餘歸為 unknown
export const PROVIDER_ERROR_CLASSES = ["timeout", "rate_limit", "interrupted", "auth", "unknown"] as const;
export type ProviderErrorClass = (typeof PROVIDER_ERROR_CLASSES)[number];

// S-04：角色可用工具的固定清單。沒有發送訊息、寫入記憶或修改設定的工具
export const ROLE_TOOLS = ["provider_search", "allowlisted_fetch", "transit_status"] as const;
export type RoleTool = (typeof ROLE_TOOLS)[number];

export interface ProviderRequest {
  model: string;
  system: string;
  input: string;
  // 結構化輸出的 JSON Schema
  outputSchema: Record<string, unknown>;
  tools: readonly RoleTool[];
  maxTokens: number;
}

export interface ProviderResponse {
  output: unknown;
  usage: { inputTokens: number; outputTokens: number };
  citations: { url: string; retrievedAt: Date }[];
}

export interface ProviderAdapter {
  id: string;
  authMethods: readonly CredentialKind[];
  builtInSearch: boolean;
  generate(request: ProviderRequest, credential: Credential): Promise<ProviderResponse>;
  classifyError(error: unknown): ProviderErrorClass;
}

// 錯誤分類必須對任何輸入回傳已定義的類別，不可拋出錯誤
const ERROR_SAMPLES: unknown[] = [
  new Error("timeout"),
  { status: 401 },
  { status: 429 },
  { status: 500 },
  "string error",
  null,
  undefined,
];

export function checkProviderAdapter(adapter: ProviderAdapter): string[] {
  const issues = checkId(adapter.id);
  if (adapter.authMethods.length === 0) issues.push("至少要支援一種認證方式");
  issues.push(...checkList("認證方式", adapter.authMethods, CREDENTIAL_KINDS));
  if (typeof adapter.builtInSearch !== "boolean") issues.push("builtInSearch 必須是布林值");
  if (typeof adapter.generate !== "function") issues.push("缺少 generate");
  if (typeof adapter.classifyError !== "function") {
    issues.push("缺少 classifyError");
    return issues;
  }
  for (const sample of ERROR_SAMPLES) {
    try {
      const result = adapter.classifyError(sample);
      if (!(PROVIDER_ERROR_CLASSES as readonly string[]).includes(result)) {
        issues.push(`classifyError 回傳未定義的類別：${String(result)}`);
        break;
      }
    } catch {
      issues.push("classifyError 不可拋出錯誤");
      break;
    }
  }
  return issues;
}

// ── 角色 ────────────────────────────────────────────────

export const DATA_SCOPES = ["itinerary", "candidates", "baseline", "live_status", "weather"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export interface MemoryScope {
  layers: readonly Memory["layer"][];
  kinds: readonly Memory["kind"][];
}

// 與 Zod schema 的 safeParse 相容，角色可直接傳入 packages/schemas 的 schema
export interface OutputIssue {
  path: readonly PropertyKey[];
  message: string;
}

export interface OutputValidator {
  safeParse(value: unknown): { success: boolean; error?: { issues: readonly OutputIssue[] } };
}

export const ROLE_LIMITS = { maxSteps: 100, maxTokens: 1_000_000 } as const;

export interface RoleSpec {
  id: string;
  // 角色的系統提示
  instructions: string;
  tools: readonly RoleTool[];
  output: OutputValidator;
  // 送給 AI 的結構化輸出格式；回傳後仍以 output 嚴格驗證（S-02）
  outputJsonSchema: Record<string, unknown>;
  // S-06：超過即停止並記錄
  maxSteps: number;
  maxTokens: number;
  dataScope: readonly DataScope[];
  // MEM-11：送往 AI 的記憶只包含此範圍
  memoryScope: MemoryScope;
}

function checkLimit(label: string, value: number, max: number): string[] {
  return Number.isInteger(value) && value >= 1 && value <= max ? [] : [`${label}必須是 1 至 ${max} 的整數`];
}

export function checkRoleSpec(role: RoleSpec): string[] {
  const issues = checkId(role.id);
  issues.push(...checkList("工具", role.tools, ROLE_TOOLS));
  if (typeof role.output?.safeParse !== "function") issues.push("缺少輸出 schema");
  if (typeof role.instructions !== "string" || role.instructions.trim().length === 0) issues.push("缺少系統提示");
  if (typeof role.outputJsonSchema !== "object" || role.outputJsonSchema === null || role.outputJsonSchema.type !== "object") {
    issues.push("輸出 JSON Schema 必須是物件");
  }
  issues.push(...checkLimit("步數上限", role.maxSteps, ROLE_LIMITS.maxSteps));
  issues.push(...checkLimit("token 上限", role.maxTokens, ROLE_LIMITS.maxTokens));
  issues.push(...checkList("資料範圍", role.dataScope, DATA_SCOPES));
  issues.push(...checkList("記憶層級", role.memoryScope.layers, enums.memoryLayer.options));
  issues.push(...checkList("記憶類型", role.memoryScope.kinds, enums.memoryKind.options));
  return issues;
}

// MEM-11：只保留角色記憶範圍內的記憶
export function scopeMemories(memories: readonly Memory[], scope: MemoryScope): Memory[] {
  return memories.filter((m) => scope.layers.includes(m.layer) && scope.kinds.includes(m.kind));
}

// ── 資料源 ──────────────────────────────────────────────

export const DATA_CAPABILITIES = ["place", "route", "transit_status", "weather", "alert"] as const;
export type DataCapability = (typeof DATA_CAPABILITIES)[number];

export interface DataSourceRequest {
  capability: DataCapability;
  params: Record<string, unknown>;
}

export interface DataSourceResult {
  capability: DataCapability;
  data: unknown;
  retrievedAt: Date;
  source: { name: string; url: string };
}

export interface DataSourceAdapter {
  id: string;
  capabilities: readonly DataCapability[];
  // 地區代碼清單，或適用所有地區
  regions: readonly string[] | "global";
  // 需要 fetch 的主機，經 PR 加入白名單（第 7.2 節）
  fetchHosts: readonly string[];
  query(request: DataSourceRequest): Promise<DataSourceResult>;
}

export function checkDataSourceAdapter(adapter: DataSourceAdapter): string[] {
  const issues = checkId(adapter.id);
  if (adapter.capabilities.length === 0) issues.push("至少要宣告一項能力");
  issues.push(...checkList("能力", adapter.capabilities, DATA_CAPABILITIES));
  if (adapter.regions !== "global") {
    const bad = adapter.regions.filter((r) => !REGION_ID.test(r));
    if (bad.length > 0 || adapter.regions.length === 0) issues.push("地區必須是 global 或兩個大寫字母的地區代碼");
  }
  const badHosts = adapter.fetchHosts.filter((h) => !HOST.test(h));
  if (badHosts.length > 0) issues.push(`fetch 主機格式錯誤：${badHosts.join("、")}`);
  if (typeof adapter.query !== "function") issues.push("缺少 query");
  return issues;
}

// ── 地區 ────────────────────────────────────────────────

const CURRENCY = /^[A-Z]{3}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export interface OfficialSource {
  id: string;
  name: string;
  url: string;
}

export interface RegionPack {
  // ISO 3166-1 alpha-2
  id: string;
  timeZone: string;
  currency: string;
  languages: readonly string[];
  transitStatusSources: readonly OfficialSource[];
  weatherAlertSources: readonly OfficialSource[];
  officialSiteAllowlist: readonly string[];
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function checkSources(label: string, sources: readonly OfficialSource[], allowlist: readonly string[]): string[] {
  const issues: string[] = [];
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      issues.push(`${label}「${source.id}」網址格式錯誤`);
      continue;
    }
    if (url.protocol !== "https:") issues.push(`${label}「${source.id}」必須使用 https`);
    if (!allowlist.includes(url.hostname)) issues.push(`${label}「${source.id}」的主機不在官方網站白名單`);
  }
  const dup = duplicates(sources.map((s) => s.id));
  if (dup.length > 0) issues.push(`${label} id 重複：${dup.join("、")}`);
  return issues;
}

export function checkRegionPack(pack: RegionPack): string[] {
  const issues: string[] = [];
  if (!REGION_ID.test(pack.id)) issues.push("id 必須是兩個大寫字母的地區代碼");
  if (!isTimeZone(pack.timeZone)) issues.push("時區必須是 IANA 名稱");
  if (!CURRENCY.test(pack.currency)) issues.push("幣別必須是 ISO 4217 三個大寫字母");
  if (pack.languages.length === 0) issues.push("至少要有一種語言");
  if (pack.languages.some((l) => !LANGUAGE.test(l))) issues.push("語言必須是 BCP 47 語言標籤");
  const badHosts = pack.officialSiteAllowlist.filter((h) => !HOST.test(h));
  if (badHosts.length > 0) issues.push(`白名單主機格式錯誤：${badHosts.join("、")}`);
  issues.push(...checkSources("交通狀態來源", pack.transitStatusSources, pack.officialSiteAllowlist));
  issues.push(...checkSources("天氣警報來源", pack.weatherAlertSources, pack.officialSiteAllowlist));
  return issues;
}

// ── 功能開關（F-05） ─────────────────────────────────────

export interface FeatureFlag {
  key: string;
  enabled: boolean;
}

// 未登記的功能視為關閉
export function isFeatureEnabled(flags: readonly FeatureFlag[], key: string): boolean {
  return flags.some((f) => f.key === key && f.enabled);
}
