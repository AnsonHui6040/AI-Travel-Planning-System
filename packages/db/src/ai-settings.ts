import {
  AI_ROLES,
  defaultRoleSetting,
  validateRoleSetting,
  type AiRole,
  type RoleSetting,
  type UsageEntry,
} from "@atps/core";
import { tableSchemas } from "@atps/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

// T14：角色設定與 AI 用量。client 以請求者本人的 session 建立，受 RLS 限制（只限本人）。

type QueryClient = Pick<SupabaseClient, "from">;

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

export class SupabaseRoleSettingsRepository {
  constructor(private readonly client: QueryClient) {}

  // 沒有儲存的角色以決策 0006 的預設值補上，依角色固定順序回傳
  async list(ownerId: string): Promise<RoleSetting[]> {
    const result: QueryResult = await this.client.from("ai_role_settings").select("*").eq("owner_id", ownerId);
    if (result.error) throw new Error("讀取 ai_role_settings 失敗");
    const rows = tableSchemas.ai_role_settings.array().parse(result.data ?? []);
    return AI_ROLES.map((role) => {
      const row = rows.find((r) => r.role === role);
      return row
        ? { role, chain: row.chain.map((c) => ({ ...c })), maxSteps: row.max_steps, maxTokens: row.max_tokens }
        : defaultRoleSetting(role);
    });
  }

  async save(ownerId: string, setting: RoleSetting): Promise<void> {
    const issues = validateRoleSetting(setting);
    if (issues.length > 0) throw new Error(issues.join("；"));
    const result: QueryResult = await this.client.from("ai_role_settings").upsert(
      {
        owner_id: ownerId,
        role: setting.role,
        chain: setting.chain,
        max_steps: setting.maxSteps,
        max_tokens: setting.maxTokens,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,role" },
    );
    if (result.error) throw new Error("儲存 ai_role_settings 失敗");
  }
}

export interface RoleUsageSummary {
  role: AiRole;
  runs: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
}

// S-06：用量紀錄與每個角色的加總
export class SupabaseUsageRecorder {
  constructor(private readonly client: QueryClient) {}

  async record(entry: UsageEntry): Promise<void> {
    const result: QueryResult = await this.client.from("ai_usage").insert({
      owner_id: entry.ownerId,
      job_id: entry.jobId,
      role: entry.role,
      provider: entry.provider,
      model: entry.model,
      steps: entry.steps,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      outcome: entry.outcome,
    });
    if (result.error) throw new Error("寫入 ai_usage 失敗");
  }

  async summary(ownerId: string, since: Date): Promise<RoleUsageSummary[]> {
    const result: QueryResult = await this.client
      .from("ai_usage")
      .select("*")
      .eq("owner_id", ownerId)
      .gte("created_at", since.toISOString());
    if (result.error) throw new Error("讀取 ai_usage 失敗");
    const rows = tableSchemas.ai_usage.array().parse(result.data ?? []);
    return AI_ROLES.map((role) => {
      const mine = rows.filter((r) => r.role === role);
      return {
        role,
        runs: mine.length,
        steps: mine.reduce((sum, r) => sum + r.steps, 0),
        inputTokens: mine.reduce((sum, r) => sum + r.input_tokens, 0),
        outputTokens: mine.reduce((sum, r) => sum + r.output_tokens, 0),
      };
    });
  }
}
