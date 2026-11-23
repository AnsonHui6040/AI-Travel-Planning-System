import type { AiProvider, AiRole, ChainEntry, RoleSetting } from "./ai-settings";
import { PROVIDER_NAMES } from "./ai-settings";
import type {
  Credential,
  OutputIssue,
  ProviderAdapter,
  ProviderErrorClass,
  RoleSpec,
  RoleTool,
} from "./extensions";

// T14：角色執行器。
// S-02：輸出以角色 schema 嚴格驗證，不符即丟棄並記錄，回傳原因與欄位，不回傳內容。
// S-06：步數與 token 超過上限即停止。
// C-08：供應商故障時不自動切換，回傳下一家由使用者確認；確認後以 providerIndex 指定重跑。

// 由 AI 端執行的工具；白名單 fetch 與交通狀態由伺服器先取得資料再傳入（S-04）
const MODEL_SIDE_TOOLS: readonly RoleTool[] = ["provider_search"];
// 每次呼叫的輸出上限
const PER_CALL_OUTPUT_TOKENS = 16_000;

export interface RoleUsage {
  steps: number;
  inputTokens: number;
  outputTokens: number;
}

export type RoleOutcome = "completed" | "output_invalid" | "limit_reached" | "provider_failed";

export interface UsageEntry extends RoleUsage {
  ownerId: string;
  jobId: string | null;
  role: AiRole;
  provider: AiProvider;
  model: string;
  outcome: RoleOutcome;
}

export interface RoleRunDeps {
  adapterFor(provider: AiProvider): ProviderAdapter;
  // C-05：只取請求者本人（或背景 job 發起人）的 key；沒有時回傳 null
  credentialFor(provider: AiProvider): Promise<Credential | null>;
  recordUsage(entry: UsageEntry): Promise<void>;
}

export interface RoleRunInput {
  role: RoleSpec;
  setting: RoleSetting;
  input: string;
  ownerId: string;
  jobId: string | null;
  // 使用備援次序中的第幾家；預設 0，使用者確認切換後傳入下一家
  providerIndex?: number;
}

export type RoleRunResult =
  | { status: "completed"; output: unknown; provider: AiProvider; model: string; usage: RoleUsage }
  | { status: "output_invalid"; reason: string; fields: string[]; provider: AiProvider; model: string; usage: RoleUsage }
  | { status: "limit_reached"; limit: "steps" | "tokens"; provider: AiProvider; model: string; usage: RoleUsage }
  | {
      status: "provider_failed";
      kind: ProviderErrorClass;
      failedProvider: AiProvider;
      next: ChainEntry | null;
      usage: RoleUsage;
    }
  | { status: "not_configured"; reason: string; usage: RoleUsage };

function issuePaths(issues: readonly OutputIssue[] | undefined): string[] {
  const paths = (issues ?? []).map((i) => i.path.map(String).join(".") || "（整體）");
  return [...new Set(paths)].slice(0, 10);
}

export async function runRole(deps: RoleRunDeps, run: RoleRunInput): Promise<RoleRunResult> {
  const index = run.providerIndex ?? 0;
  const entry = run.setting.chain[index];
  if (!entry) throw new Error("超出備援次序範圍");
  const usage: RoleUsage = { steps: 0, inputTokens: 0, outputTokens: 0 };
  const name = PROVIDER_NAMES[entry.provider];

  if (entry.model === null) return { status: "not_configured", reason: `尚未選擇 ${name} 的模型`, usage };
  const credential = await deps.credentialFor(entry.provider);
  if (!credential) return { status: "not_configured", reason: `尚未設定 ${name} 的 API key`, usage };

  const model = entry.model;
  const adapter = deps.adapterFor(entry.provider);
  const tools = run.role.tools.filter((t) => MODEL_SIDE_TOOLS.includes(t));
  const record = (outcome: RoleOutcome) =>
    deps.recordUsage({
      ownerId: run.ownerId,
      jobId: run.jobId,
      role: run.setting.role,
      provider: entry.provider,
      model,
      outcome,
      ...usage,
    });

  let feedback = "";
  let lastFields: string[] = [];
  while (usage.steps < run.setting.maxSteps) {
    const remaining = run.setting.maxTokens - usage.inputTokens - usage.outputTokens;
    if (remaining <= 0) break;

    let response;
    try {
      response = await adapter.generate(
        {
          model,
          system: run.role.instructions,
          input: feedback ? `${run.input}\n\n${feedback}` : run.input,
          outputSchema: run.role.outputJsonSchema,
          tools,
          maxTokens: Math.min(PER_CALL_OUTPUT_TOKENS, remaining),
        },
        credential,
      );
    } catch (error) {
      usage.steps += 1;
      await record("provider_failed");
      return {
        status: "provider_failed",
        kind: adapter.classifyError(error),
        failedProvider: entry.provider,
        next: run.setting.chain[index + 1] ?? null,
        usage,
      };
    }

    usage.steps += 1;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    if (usage.inputTokens + usage.outputTokens > run.setting.maxTokens) {
      await record("limit_reached");
      return { status: "limit_reached", limit: "tokens", provider: entry.provider, model, usage };
    }

    const parsed = run.role.output.safeParse(response.output);
    if (parsed.success) {
      await record("completed");
      return { status: "completed", output: response.output, provider: entry.provider, model, usage };
    }
    // 丟棄不符的輸出，只把欄位位置回饋給下一次呼叫
    lastFields = issuePaths(parsed.error?.issues);
    feedback = `上一次的輸出不符合格式，問題欄位：${lastFields.join("、")}。請重新輸出完整且符合格式的 JSON。`;
  }

  if (lastFields.length > 0) {
    await record("output_invalid");
    return {
      status: "output_invalid",
      reason: `AI 輸出不符合格式，已重試 ${usage.steps} 次`,
      fields: lastFields,
      provider: entry.provider,
      model,
      usage,
    };
  }
  await record("limit_reached");
  return {
    status: "limit_reached",
    limit: usage.steps >= run.setting.maxSteps ? "steps" : "tokens",
    provider: entry.provider,
    model,
    usage,
  };
}
