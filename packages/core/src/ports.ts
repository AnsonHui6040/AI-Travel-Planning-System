import type { Row } from "@atps/schemas";

// M-04：core 定義的 port。實作放在 packages/db 與各 adapter 套件，core 不 import 外部 SDK。
// 正式資料的寫入只經 applyChange 與 ChangeWriter（T09），其餘 repository 只提供讀取與提案建立。

export type ItineraryItem = Row<"itinerary_items">;
export type Proposal = Row<"proposals">;
export type Memory = Row<"memories">;
export type NotificationRow = Row<"notifications">;

export interface ItineraryRepository {
  listItems(tripId: string): Promise<ItineraryItem[]>;
}

export interface NewMemberProposal {
  tripId: string;
  memberId: string;
  baseVersion: number;
  change: Proposal["change"];
  impactScope: Proposal["impact_scope"];
}

export interface ProposalRepository {
  listByTrip(tripId: string): Promise<Proposal[]>;
  createMemberProposal(input: NewMemberProposal): Promise<Proposal>;
}

export interface MemoryReader {
  listForOwner(ownerId: string): Promise<Memory[]>;
}

export interface Notification {
  recipientId: string;
  tripId: string | null;
  kind: string;
  refTable?: string;
  refId?: string;
}

export interface Notifier {
  notify(notification: Notification): Promise<void>;
}

export interface Clock {
  now(): Date;
}

// ChangeWriter：applyChange 使用的寫入角色。實作在資料庫交易內完成版本檢查（SH-04）、
// 寫入行程與版本、同分支提案失效與通知成員（SH-06）。
export type CommitResult =
  | { outcome: "applied"; version: { major: number; minor: number }; invalidatedIds: string[] }
  | { outcome: "invalidated" };

export interface ChangeWriter {
  approve(input: { proposalId: string; actorId: string }): Promise<CommitResult>;
  autoApply(input: { proposalId: string }): Promise<CommitResult>;
  reject(input: { proposalId: string; actorId: string }): Promise<void>;
}

export interface NotificationRepository {
  listUnread(memberId: string): Promise<NotificationRow[]>;
  markRead(notificationId: string, at: Date): Promise<void>;
}
