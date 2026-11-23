import type { Row } from "@atps/schemas";
import type { FeatureFlag, MemoryScope } from "./extensions";

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

// MEM-11：只讀取角色記憶範圍內的記憶。預設實作回傳空記憶（packages/memory），T41 實作完整版本
export interface MemoryRequest {
  ownerIds: readonly string[];
  tripId: string | null;
  scope: MemoryScope;
}

export interface MemoryReader {
  read(request: MemoryRequest): Promise<Memory[]>;
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

// T10A：復原舊版本。實作在資料庫交易內檢查權限與 base version（SH-04），
// 把行程排程改回所選版本的快照並建立新版本；原有版本紀錄不變。
export type VersionRow = Row<"versions">;

export interface RestoreResult {
  version: { major: number; minor: number };
  versionId: string;
}

export interface VersionRestorer {
  restore(input: { versionId: string; baseVersion: number }): Promise<RestoreResult>;
}

export interface NotificationRepository {
  listUnread(memberId: string): Promise<NotificationRow[]>;
  markRead(notificationId: string, at: Date): Promise<void>;
}

// ── 第 7.1 節預留擴充點（第一版不實作）────────────────────

// F-05：功能開關。讀取失敗時拋出錯誤，不當作全部關閉
export interface FeatureFlagReader {
  list(): Promise<FeatureFlag[]>;
}

// F-01：預算與記帳。金額欄位已存在於行程項目（T06）
export interface ExpenseEntry {
  itemId: string | null;
  amount: number;
  currency: string;
  payerId: string | null;
  note: string | null;
}

export interface ExpenseLedger {
  list(tripId: string): Promise<ExpenseEntry[]>;
  record(tripId: string, entry: ExpenseEntry): Promise<void>;
}

// F-02：日曆與地圖匯出
export type ExportFormat = "ics" | "place_list";

export interface Exporter {
  format: ExportFormat;
  export(tripId: string): Promise<{ mediaType: string; fileName: string; content: string }>;
}

// F-03：推播沿用上方 Notifier（第一版只實作站內 Realtime）。
// 定位：第一版只在進入 Incident Mode 時取得一次位置
export interface LocationEvent {
  memberId: string;
  tripId: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: Date;
}

export interface LocationSource {
  current(memberId: string): Promise<LocationEvent | null>;
}

// F-04：訂票與訂位整合。匯入結果只能成為 Hard Constraint 提案，經批准才寫入
export interface ImportedBooking {
  constraintClass: "hard_constraint";
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  reference: string | null;
}

export interface Importer {
  id: string;
  parse(input: { mediaType: string; content: string }): Promise<ImportedBooking[]>;
}
