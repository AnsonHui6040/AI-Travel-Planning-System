import { defaultRoleSetting, runRole, type RoleRunDeps, type RoleRunResult, type RoleSetting } from "@atps/core";
import { roleSpec } from "@atps/ai";
import { roleOutputs } from "@atps/schemas";
import { judgeOutput, type JudgeResult } from "./judges";
import type { Scenario } from "./scenario";

// T15：評估 runner。每個場景依 runs 連續執行，全部通過才算通過（第 9.1 節）。
// 每次都經 core 的 runRole：輸出 schema 驗證、步數與 token 上限與正式執行相同。

export type Invoke = (scenario: Scenario, attempt: number) => Promise<RoleRunResult>;

export interface RunReport {
  attempt: number;
  status: RoleRunResult["status"];
  provider: string | null;
  model: string | null;
  passed: boolean;
  judges: JudgeResult[];
  note: string | null;
}

export interface ScenarioReport {
  scenario: Pick<Scenario, "id" | "title" | "rule" | "role">;
  runs: RunReport[];
  passed: boolean;
}

const EVAL_OWNER = "00000000-0000-4000-8000-00000000e7a1";

export function buildInput(scenario: Scenario): string {
  return `${scenario.instruction}\n\n行程資料（JSON）：\n${JSON.stringify(scenario.trip.items)}`;
}

function note(result: RoleRunResult): string | null {
  switch (result.status) {
    case "completed":
      return null;
    case "output_invalid":
      return `${result.reason}（欄位：${result.fields.join("、")}）`;
    case "limit_reached":
      return `超過${result.limit === "steps" ? "步數" : " token "}上限`;
    case "provider_failed":
      return `供應商錯誤：${result.kind}`;
    case "not_configured":
      return result.reason;
  }
}

// 以指定的 deps（真 adapter 與使用者本人的 key）執行
export function roleInvoker(deps: RoleRunDeps, setting?: RoleSetting): Invoke {
  return (scenario) =>
    runRole(deps, {
      role: roleSpec(scenario.role),
      setting: setting ?? defaultRoleSetting(scenario.role),
      input: buildInput(scenario),
      ownerId: EVAL_OWNER,
      jobId: null,
    });
}

// 錄製回應：第 n 次執行使用第 n 筆（不足時循環）
export function replayInvoker(responses: readonly unknown[]): Invoke {
  if (responses.length === 0) throw new Error("沒有錄製回應");
  return (scenario, attempt) => {
    const output = responses[attempt % responses.length];
    const deps: RoleRunDeps = {
      adapterFor: (provider) => ({
        id: provider,
        authMethods: ["api_key"],
        builtInSearch: false,
        generate: async () => ({ output, usage: { inputTokens: 0, outputTokens: 0 }, citations: [] }),
        classifyError: () => "unknown",
      }),
      credentialFor: async () => ({ kind: "api_key", secret: "replay" }),
      recordUsage: async () => {},
    };
    return roleInvoker(deps)(scenario, attempt);
  };
}

export async function runScenario(scenario: Scenario, invoke: Invoke, options: { runs?: number } = {}): Promise<ScenarioReport> {
  const total = options.runs ?? scenario.runs;
  const runs: RunReport[] = [];
  for (let attempt = 0; attempt < total; attempt++) {
    const result = await invoke(scenario, attempt);
    const base = {
      attempt: attempt + 1,
      status: result.status,
      provider: "provider" in result ? result.provider : null,
      model: "model" in result ? result.model : null,
    };
    if (result.status !== "completed") {
      runs.push({ ...base, passed: false, judges: [], note: note(result) });
      continue;
    }
    // runRole 已驗證；此處再解析一次以取得型別
    const judges = judgeOutput(scenario, roleOutputs[scenario.role].parse(result.output));
    runs.push({ ...base, passed: judges.every((j) => j.pass), judges, note: null });
  }
  const { id, title, rule, role } = scenario;
  return { scenario: { id, title, rule, role }, runs, passed: runs.every((r) => r.passed) };
}
