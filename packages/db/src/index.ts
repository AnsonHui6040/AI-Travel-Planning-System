import type {
  ApiKeyProvider,
  ApiKeyStore,
  KeyDecryptor,
  ChangeWriter,
  CommitResult,
  FeatureFlag,
  FeatureFlagReader,
  ItineraryItem,
  ItineraryRepository,
  Memory,
  MemoryReader,
  MemoryRequest,
  NewMemberProposal,
  Notification,
  NotificationRepository,
  NotificationRow,
  Notifier,
  Proposal,
  ProposalRepository,
  RestoreResult,
  VersionRestorer,
} from "@atps/core";
import { scopeMemories } from "@atps/core";
import { commitResult, restoreResult, tableSchemas, type Row, type TableName } from "@atps/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

export { SupabaseRoleSettingsRepository, SupabaseUsageRecorder, type RoleUsageSummary } from "./ai-settings";

// M-04：core port 的 Supabase 實作。client 以請求者本人的 session 建立，存取受 RLS 限制（C-09）。
// 讀出的每一列都以 row schema 驗證，不符即拋出錯誤。

export type QueryClient = Pick<SupabaseClient, "from">;
export type RpcClient = Pick<SupabaseClient, "rpc">;

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function parseRows<T extends TableName>(table: T, result: QueryResult) {
  if (result.error) throw new Error(`讀取 ${table} 失敗`);
  return tableSchemas[table].array().parse(result.data ?? []);
}

function parseRow<T extends TableName>(table: T, result: QueryResult) {
  if (result.error) throw new Error(`寫入 ${table} 失敗`);
  return tableSchemas[table].parse(result.data);
}

export class SupabaseItineraryRepository implements ItineraryRepository {
  constructor(private readonly client: QueryClient) {}

  async listItems(tripId: string): Promise<ItineraryItem[]> {
    const result = await this.client
      .from("itinerary_items")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at");
    return parseRows("itinerary_items", result) as ItineraryItem[];
  }
}

export class SupabaseProposalRepository implements ProposalRepository {
  constructor(private readonly client: QueryClient) {}

  async listByTrip(tripId: string): Promise<Proposal[]> {
    const result = await this.client
      .from("proposals")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at");
    return parseRows("proposals", result) as Proposal[];
  }

  async createMemberProposal(input: NewMemberProposal): Promise<Proposal> {
    const result = await this.client
      .from("proposals")
      .insert({
        trip_id: input.tripId,
        proposer_member_id: input.memberId,
        proposer_role: null,
        base_version: input.baseVersion,
        change: input.change,
        impact_scope: input.impactScope,
        status: "pending",
      })
      .select("*")
      .single();
    return parseRow("proposals", result) as Proposal;
  }
}

export class SupabaseMemoryReader implements MemoryReader {
  constructor(private readonly client: QueryClient) {}

  // MEM-11：查詢只取記憶範圍內的層級與類型，回傳前再以 core 的 scopeMemories 過濾一次
  async read(request: MemoryRequest): Promise<Memory[]> {
    const { ownerIds, scope } = request;
    if (ownerIds.length === 0 || scope.layers.length === 0 || scope.kinds.length === 0) return [];
    const result = await this.client
      .from("memories")
      .select("*")
      .in("owner_id", [...ownerIds])
      .in("layer", [...scope.layers])
      .in("kind", [...scope.kinds])
      .order("created_at");
    return scopeMemories(parseRows("memories", result) as Memory[], scope);
  }
}

// F-05：功能開關。讀取失敗時拋出錯誤
export class SupabaseFeatureFlagReader implements FeatureFlagReader {
  constructor(private readonly client: QueryClient) {}

  async list(): Promise<FeatureFlag[]> {
    const result = await this.client.from("feature_flags").select("*").order("key");
    const rows = parseRows("feature_flags", result) as Row<"feature_flags">[];
    return rows.map(({ key, enabled }) => ({ key, enabled }));
  }
}

export class SupabaseNotifier implements Notifier {
  constructor(private readonly client: QueryClient) {}

  async notify(notification: Notification): Promise<void> {
    const result = await this.client.from("notifications").insert({
      recipient_id: notification.recipientId,
      trip_id: notification.tripId,
      kind: notification.kind,
      ref_table: notification.refTable ?? null,
      ref_id: notification.refId ?? null,
    });
    if (result.error) throw new Error("寫入 notifications 失敗");
  }
}

// T09：applyChange 的寫入角色。資料庫函式以 atps_change_writer 身分在單一交易內完成
// 版本檢查、寫入行程與 Change Log、同分支失效與通知；呼叫者只傳提案編號，批准者取自 session。

export class SupabaseChangeWriter implements ChangeWriter {
  constructor(private readonly client: RpcClient) {}

  private async commit(fn: "approve_proposal" | "auto_apply_proposal", proposalId: string): Promise<CommitResult> {
    const result = await this.client.rpc(fn, { p_proposal_id: proposalId });
    if (result.error) throw new Error("套用變更失敗");
    const parsed = commitResult.parse(result.data);
    if (parsed.outcome === "invalidated") return { outcome: "invalidated" };
    return {
      outcome: "applied",
      version: { major: parsed.major, minor: parsed.minor },
      invalidatedIds: parsed.invalidated_ids,
    };
  }

  approve(input: { proposalId: string; actorId: string }): Promise<CommitResult> {
    return this.commit("approve_proposal", input.proposalId);
  }

  // 只限伺服器以 service role 呼叫；資料庫另檢查只允許第 2.6 節自動套用類別
  autoApply(input: { proposalId: string }): Promise<CommitResult> {
    return this.commit("auto_apply_proposal", input.proposalId);
  }

  async reject(input: { proposalId: string; actorId: string }): Promise<void> {
    const result = await this.client.rpc("reject_proposal", { p_proposal_id: input.proposalId });
    if (result.error) throw new Error("否決提案失敗");
  }
}

// T10A：復原舊版本。權限、base version 與寫入都在資料庫函式內以寫入角色完成，復原者取自 session。
export class SupabaseVersionRestorer implements VersionRestorer {
  constructor(private readonly client: RpcClient) {}

  async restore(input: { versionId: string; baseVersion: number }): Promise<RestoreResult> {
    const result = await this.client.rpc("restore_version", {
      p_version_id: input.versionId,
      p_base_version: input.baseVersion,
    });
    if (result.error) throw new Error("復原版本失敗");
    const parsed = restoreResult.parse(result.data);
    return { version: { major: parsed.major, minor: parsed.minor }, versionId: parsed.version_id };
  }
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly client: QueryClient) {}

  async listUnread(memberId: string): Promise<NotificationRow[]> {
    const result = await this.client
      .from("notifications")
      .select("*")
      .eq("recipient_id", memberId)
      .is("read_at", null)
      .order("created_at");
    return parseRows("notifications", result) as NotificationRow[];
  }

  async markRead(notificationId: string, at: Date): Promise<void> {
    const result = await this.client.from("notifications").update({ read_at: at.toISOString() }).eq("id", notificationId);
    if (result.error) throw new Error("更新 notifications 失敗");
  }
}

// T12：API key 的儲存與解密只經資料庫函式，client 須以 service role 建立，只在伺服器使用（C-09）。
// 錯誤訊息固定，不帶出 key 或資料庫訊息（C-04）。
export class SupabaseApiKeyStore implements ApiKeyStore {
  constructor(private readonly client: RpcClient) {}

  async save(input: { ownerId: string; provider: ApiKeyProvider; secret: string; testedAt: Date | null }) {
    const result = await this.client.rpc("save_api_key", {
      p_owner: input.ownerId,
      p_provider: input.provider,
      p_secret: input.secret,
      p_tested_at: input.testedAt?.toISOString() ?? null,
    });
    if (result.error) throw new Error("儲存 API key 失敗");
  }
}

export class SupabaseKeyDecryptor implements KeyDecryptor {
  constructor(private readonly client: RpcClient) {}

  async forOwner(ownerId: string, provider: ApiKeyProvider): Promise<string | null> {
    return this.call("decrypt_api_key", { p_owner: ownerId, p_provider: provider });
  }

  async forJob(jobId: string, provider: ApiKeyProvider): Promise<string | null> {
    return this.call("decrypt_job_api_key", { p_job_id: jobId, p_provider: provider });
  }

  private async call(fn: string, args: Record<string, string>): Promise<string | null> {
    const result = await this.client.rpc(fn, args);
    if (result.error || (result.data !== null && typeof result.data !== "string")) {
      throw new Error("讀取 API key 失敗");
    }
    return result.data;
  }
}
