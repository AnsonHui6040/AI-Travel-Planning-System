import type {
  ItineraryItem,
  ItineraryRepository,
  Memory,
  MemoryReader,
  NewMemberProposal,
  Notification,
  Notifier,
  Proposal,
  ProposalRepository,
} from "@atps/core";
import { tableSchemas, type TableName } from "@atps/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

// M-04：core port 的 Supabase 實作。client 以請求者本人的 session 建立，存取受 RLS 限制（C-09）。
// 讀出的每一列都以 row schema 驗證，不符即拋出錯誤。

export type QueryClient = Pick<SupabaseClient, "from">;

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

  async listForOwner(ownerId: string): Promise<Memory[]> {
    const result = await this.client.from("memories").select("*").eq("owner_id", ownerId).order("created_at");
    return parseRows("memories", result) as Memory[];
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
