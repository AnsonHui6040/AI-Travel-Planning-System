import type { Row } from "@atps/schemas";

// M-04：core 定義的 port。實作放在 packages/db 與各 adapter 套件，core 不 import 外部 SDK。
// 正式資料的寫入只經 applyChange（T09），此處的 repository 只提供讀取與提案建立。

export type ItineraryItem = Row<"itinerary_items">;
export type Proposal = Row<"proposals">;
export type Memory = Row<"memories">;

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
