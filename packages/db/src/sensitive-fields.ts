import { aiSensitiveRows, visibleSensitiveRows, type SensitiveField } from "@atps/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

type RpcClient = Pick<SupabaseClient, "rpc">;

// T17：敏感欄位只經資料庫函式存取（S-07、D18）。
// save、setSharing、listForTrip 以使用者 session 的 client 呼叫；forAi 以 service role client 呼叫。
// 錯誤訊息固定，不含值（S-10）。

export interface Sharing {
  ai: boolean;
  members: boolean;
  viewers: boolean;
}

export interface VisibleSensitiveField {
  userId: string;
  field: SensitiveField;
  value: string;
  // 只有自己的欄位有開關資料
  sharing: Sharing | null;
}

export interface AiSensitiveField {
  userId: string;
  field: SensitiveField;
  value: string;
  shareAi: true;
}

export class SensitiveFieldFormatError extends Error {
  constructor() {
    super("敏感欄位格式不正確");
  }
}

export class SupabaseSensitiveFields {
  constructor(private readonly client: RpcClient) {}

  async save(tripId: string, field: SensitiveField, value: string): Promise<void> {
    const result = await this.client.rpc("save_sensitive_field", { p_trip: tripId, p_field: field, p_value: value });
    if (result.error) {
      if ((result.error as { code?: string }).code === "22023") throw new SensitiveFieldFormatError();
      throw new Error("儲存敏感欄位失敗");
    }
  }

  async setSharing(tripId: string, field: SensitiveField, sharing: Sharing): Promise<void> {
    const result = await this.client.rpc("set_sensitive_sharing", {
      p_trip: tripId,
      p_field: field,
      p_share_ai: sharing.ai,
      p_share_members: sharing.members,
      p_share_viewers: sharing.viewers,
    });
    if (result.error) throw new Error("儲存敏感欄位開關失敗");
  }

  async listForTrip(tripId: string): Promise<VisibleSensitiveField[]> {
    const rows = await this.read("list_trip_sensitive_fields", { p_trip: tripId }, visibleSensitiveRows);
    return rows.map((r) => ({
      userId: r.user_id,
      field: r.field,
      value: r.value,
      sharing:
        r.share_ai === null || r.share_members === null || r.share_viewers === null
          ? null
          : { ai: r.share_ai, members: r.share_members, viewers: r.share_viewers },
    }));
  }

  async forAi(tripId: string, requesterId: string): Promise<AiSensitiveField[]> {
    const rows = await this.read("ai_sensitive_fields", { p_trip: tripId, p_requester: requesterId }, aiSensitiveRows);
    return rows.map((r) => ({ userId: r.user_id, field: r.field, value: r.value, shareAi: true }));
  }

  private async read<T>(fn: string, args: Record<string, string>, rows: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
    const result = await this.client.rpc(fn, args);
    if (result.error) throw new Error("讀取敏感欄位失敗");
    const parsed = rows.safeParse(result.data ?? []);
    if (!parsed.success) throw new Error("讀取敏感欄位失敗");
    return parsed.data;
  }
}
