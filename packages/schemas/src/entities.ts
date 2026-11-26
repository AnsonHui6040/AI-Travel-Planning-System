import { z } from "zod";
import {
  LIMITS,
  currencyCode,
  hhmm,
  httpsUrl,
  ianaTimezone,
  isoDate,
  money,
  moneyAmount,
  offsetDateTime,
  score,
  text,
  uuid,
} from "./common";
import * as E from "./enums";
import { memberSensitiveFieldRow } from "./sensitive";

// 第 2.4 節與第 2.11 節的實體。鍵名與資料庫欄位一致（snake_case），
// 一致性由 tooling/schema-migration-consistency.test.ts 檢查。所有物件拒絕未知欄位（S-02）。

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const int = (min: number, max: number) => z.int().min(min).max(max);
const json = z.json();

export const sourceRef = z.strictObject({
  url: httpsUrl,
  fetched_at: offsetDateTime,
  grade: E.sourceGrade,
});

export const modelRef = z.strictObject({
  provider: E.aiProvider,
  model: text(LIMITS.modelName),
});

// T25：AI 提出的事實主張（附來源）與依證據順序判定後的結果
export const factClaim = z.strictObject({
  field: E.factField,
  value: text(200),
  source: sourceRef,
});

export const factClaimRecord = z.strictObject({
  field: E.factField,
  value: text(200),
  source: sourceRef,
  by: modelRef,
});

export const resolvedFact = z.strictObject({
  field: E.factField,
  status: E.factStatus,
  // conflict 時為 null
  value: nullable(text(200)),
  grade: nullable(E.sourceGrade),
});

export const availabilitySlot = z
  .strictObject({
    date: isoDate.optional(),
    weekday: int(0, 6).optional(),
    start: hhmm,
    end: hhmm,
  })
  .refine((slot) => slot.start < slot.end, "結束時間須晚於開始時間");

export const profileRow = z.strictObject({
  id: uuid,
  display_name: nullable(text(80)),
  created_at: offsetDateTime,
});

export const tripRow = z.strictObject({
  id: uuid,
  name: text(120),
  destination: nullable(text(120)),
  start_date: nullable(isoDate),
  end_date: nullable(isoDate),
  timezone: ianaTimezone,
  status: E.tripStatus,
  current_version: int(0, 1_000_000),
  owner_id: uuid,
  created_at: offsetDateTime,
  // T31：旅前自動再核實排程（只有 Owner 可開關）
  reverify_enabled: z.boolean(),
});

export const tripMemberRow = z.strictObject({
  trip_id: uuid,
  user_id: uuid,
  role: z.enum(["owner", "companion", "viewer"]),
  joined_at: offsetDateTime,
});

const flight = z.strictObject({
  label: text(80),
  departs_at: offsetDateTime,
  arrives_at: offsetDateTime,
});
const lodging = z.strictObject({
  name: text(LIMITS.nameLocal),
  area: nullable(text(LIMITS.area)),
  check_in: isoDate,
  check_out: isoDate,
  check_in_time: nullable(hhmm),
});
const fixedActivity = z.strictObject({
  name: text(LIMITS.nameZh),
  // T23：地區用於矛盾檢查（例如入住後趕往另一區）；不知道時為 null
  area: nullable(text(LIMITS.area)),
  date: isoDate,
  start: hhmm,
  end: nullable(hhmm),
  paid: z.boolean(),
});

export const tripBaselineData = z
  .strictObject({
    start_date: isoDate,
    end_date: isoDate,
    timezone: ianaTimezone,
    flights: z.array(flight).max(20),
    lodgings: z.array(lodging).max(30),
    companions: int(0, 20),
    stamina_note: nullable(text(LIMITS.longText)),
    budget: nullable(money),
    fixed_activities: z.array(fixedActivity).max(50),
    paid_items: z.array(text(LIMITS.nameZh)).max(50),
    must_visit: z.array(text(LIMITS.nameZh)).max(50),
    excluded: z.array(text(LIMITS.nameZh)).max(50),
    transport_preferences: z.array(E.transportMode).max(5),
    photography_needs: nullable(text(LIMITS.longText)),
  })
  .refine((b) => b.end_date >= b.start_date, "結束日期不可早於開始日期");

export type TripBaselineData = z.infer<typeof tripBaselineData>;

export const tripBaselineRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  version: int(1, 1000),
  data: tripBaselineData,
  confirmed_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

export const itineraryItemRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  name_zh: text(LIMITS.nameZh),
  name_local: nullable(text(LIMITS.nameLocal)),
  place_id: nullable(text(300)),
  type: E.itemType,
  address: nullable(text(LIMITS.address)),
  area: nullable(text(LIMITS.area)),
  coord_lat: nullable(z.number().min(-90).max(90)),
  coord_lng: nullable(z.number().min(-180).max(180)),
  coord_fetched_at: nullable(offsetDateTime),
  suggested_stay_minutes: int(LIMITS.stayMinutes.min, LIMITS.stayMinutes.max),
  availability: z.array(availabilitySlot).max(50),
  reservation_requirement: E.reservationRequirement,
  reservation_note: nullable(text(LIMITS.shortNote)),
  constraint_class: E.constraintClass,
  is_fixed: z.boolean(),
  priority: int(LIMITS.priority.min, LIMITS.priority.max),
  weather_dependency: E.level3,
  candidate_role: E.candidateRole,
  recommendation_reason: text(LIMITS.longText),
  constraint_note: nullable(text(LIMITS.longText)),
  score_personal_value: score,
  score_uniqueness: score,
  score_geographic_fit: score,
  score_time_cost: score,
  score_transport_cost: score,
  score_weather_dependency: score,
  score_time_slot_dependency: score,
  score_substitutability: score,
  scheduled_date: nullable(isoDate),
  scheduled_start: nullable(hhmm),
  scheduled_end: nullable(hhmm),
  movable_from: nullable(hhmm),
  movable_to: nullable(hhmm),
  verification_status: E.verificationStatus,
  last_verified_at: nullable(offsetDateTime),
  sources: z.array(sourceRef).max(20),
  generated_by: nullable(modelRef),
  verified_by: nullable(modelRef),
  // T24：由哪個研究方向、哪個背景 job 產生（成員自行加入時為 null）
  research_track: nullable(E.researchTrack),
  research_job_id: nullable(uuid),
  // T25：Research 與 Verification 的事實主張，與依證據順序判定的結果
  fact_claims: z.array(factClaimRecord).max(50),
  facts: z.array(resolvedFact).max(10),
  // T27：所屬分區與由出發地前往的轉乘次數、分鐘數（AI 估算）
  zone_id: nullable(uuid),
  zone_transfers: nullable(int(0, 10)),
  zone_minutes: nullable(int(1, 1440)),
  lifecycle_status: E.lifecycleStatus,
  at_risk: z.boolean(),
  standby: z.boolean(),
  post_trip_status: nullable(E.postTripStatus),
  estimated_cost_amount: nullable(moneyAmount),
  estimated_cost_currency: nullable(currencyCode),
  actual_cost_amount: nullable(moneyAmount),
  actual_cost_currency: nullable(currencyCode),
  payer_id: nullable(uuid),
  created_at: offsetDateTime,
});

export const dayRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  date: isoDate,
  status: E.dayStatus,
  offline_pack_version: int(0, 1_000_000),
  created_at: offsetDateTime,
  // T39：Planned vs Actual（core 的 actualTimeline）
  actual_timeline: nullable(json),
  timeline_produced_at: nullable(offsetDateTime),
  timeline_produced_by: nullable(uuid),
});

export const mobilityEstimate = z.strictObject({
  mode: E.transportMode,
  door_to_door_minutes: int(LIMITS.doorToDoorMinutes.min, LIMITS.doorToDoorMinutes.max),
  price: nullable(money),
  walk_minutes: int(LIMITS.walkMinutes.min, LIMITS.walkMinutes.max),
  transfers: int(LIMITS.transfers.min, LIMITS.transfers.max),
  luggage_friendliness: E.level3,
  comfort: E.level3,
  delay_risk: E.level3,
});

// T28：AI 的估算附來源；儲存時加上固定緩衝與含緩衝的總時間（決策 0008）
export const aiMobilityEstimate = mobilityEstimate.extend({ sources: z.array(sourceRef).min(1).max(5) });

export const storedMobilityEstimate = mobilityEstimate.extend({
  source_urls: z.array(httpsUrl).min(1).max(5),
  buffer_minutes: int(LIMITS.bufferMinutes.min, LIMITS.bufferMinutes.max),
  total_minutes: int(1, LIMITS.doorToDoorMinutes.max + LIMITS.bufferMinutes.max),
});

// 推薦、最快、最便宜、最舒適或低風險四種方案（各為一種交通方式）
export const segmentPlans = z.strictObject({
  recommended: E.transportMode,
  fastest: E.transportMode,
  cheapest: E.transportMode,
  comfortable: E.transportMode,
});

export const mobilitySegmentRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  from_item_id: uuid,
  to_item_id: uuid,
  estimates: z.array(storedMobilityEstimate).max(5),
  buffer_minutes: int(LIMITS.bufferMinutes.min, LIMITS.bufferMinutes.max),
  recommended_mode: nullable(E.transportMode),
  plans: nullable(segmentPlans),
  source_urls: z.array(httpsUrl).max(10),
  maps_url: nullable(httpsUrl),
  created_at: offsetDateTime,
});

export const proposalRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  proposer_member_id: nullable(uuid),
  proposer_role: nullable(E.aiRole),
  proposer_provider: nullable(E.aiProvider),
  proposer_model: nullable(text(LIMITS.modelName)),
  base_version: int(0, 1_000_000),
  change: json,
  impact_scope: json,
  status: E.proposalStatus,
  live_branch_id: nullable(uuid),
  decided_by: nullable(uuid),
  decided_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

export const versionRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  major: int(1, 1000),
  minor: int(0, 1000),
  kind: E.versionKind,
  summary: text(500),
  reason: nullable(text(500)),
  proposal_id: nullable(uuid),
  approved_by: nullable(uuid),
  impact_scope: json,
  old_arrangement: json,
  new_arrangement: json,
  base_version: int(0, 1_000_000),
  created_at: offsetDateTime,
  snapshot: nullable(json),
  restored_from: nullable(uuid),
});

export const incidentRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  // T38：提早完成、取消時段等現場變更不分級
  level: nullable(E.incidentLevel),
  snapshot: json,
  available_minutes: nullable(int(0, 1440)),
  live_branch_id: uuid,
  created_by: uuid,
  created_at: offsetDateTime,
});

export const actualTimelineRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  item_id: uuid,
  arrived_at: nullable(offsetDateTime),
  departed_at: nullable(offsetDateTime),
  completion: E.completion,
  recorded_by: uuid,
  created_at: offsetDateTime,
});

export const notificationRow = z.strictObject({
  id: uuid,
  recipient_id: uuid,
  trip_id: nullable(uuid),
  kind: text(50),
  ref_table: nullable(text(50)),
  ref_id: nullable(uuid),
  read_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

export const memoryRow = z.strictObject({
  id: uuid,
  owner_id: uuid,
  layer: E.memoryLayer,
  trip_id: nullable(uuid),
  kind: E.memoryKind,
  item: text(LIMITS.nameZh),
  value: text(LIMITS.shortNote),
  unit: nullable(text(20)),
  source: E.memorySource,
  source_proposal_id: nullable(uuid),
  approved_at: offsetDateTime,
  last_used_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

export const apiKeyRecordRow = z.strictObject({
  id: uuid,
  owner_id: uuid,
  provider: E.keyProvider,
  vault_secret_id: uuid,
  last4: z.string().length(4),
  created_at: offsetDateTime,
  last_tested_at: nullable(offsetDateTime),
});

export const readonlyLinkRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  token_hash: z.string().regex(/^[0-9a-f]{64}$/),
  expires_at: offsetDateTime,
  revoked_at: nullable(offsetDateTime),
  created_by: uuid,
  created_at: offsetDateTime,
});

export const backgroundJobRow = z.strictObject({
  id: uuid,
  kind: text(50),
  initiator_id: uuid,
  trip_id: nullable(uuid),
  status: E.jobStatus,
  workflow_run_id: nullable(text(100)),
  steps_used: int(0, 1_000_000),
  tokens_used: int(0, 1_000_000_000),
  created_at: offsetDateTime,
  updated_at: offsetDateTime,
});

// T27：地理分區。由 AI 依自行搜尋的資料與交通估算分群（D29）；項目以 zone_id 指向分區
export const zoneRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  research_job_id: nullable(uuid),
  name: text(LIMITS.area),
  // 含出發地（住宿）的分區記錄出發地區
  base_area: nullable(text(LIMITS.area)),
  rationale: text(LIMITS.longText),
  sources: z.array(sourceRef).max(10),
  created_at: offsetDateTime,
});

export const photoRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  item_id: uuid,
  source: E.photoSource,
  license: text(100),
  author: text(LIMITS.shortNote),
  source_url: nullable(httpsUrl),
  storage_path: text(500),
  uploaded_by: uuid,
  created_at: offsetDateTime,
});

// F-05：功能開關。新功能預設關閉，只能經 migration 修改
export const featureFlagRow = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  enabled: z.boolean(),
  description: text(LIMITS.shortNote),
  updated_at: offsetDateTime,
});

// T14：角色的模型與備援次序（決策 0006）
export const roleChainEntry = z.strictObject({
  provider: E.aiProvider,
  model: nullable(z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/)),
});

export const aiRoleSettingRow = z.strictObject({
  owner_id: uuid,
  role: E.aiRole,
  chain: z.array(roleChainEntry).min(1).max(3),
  max_steps: int(1, 100),
  max_tokens: int(1_000, 1_000_000),
  updated_at: offsetDateTime,
});

export const aiUsageOutcome = z.enum(["completed", "output_invalid", "limit_reached", "provider_failed"]);

export const aiUsageRow = z.strictObject({
  id: uuid,
  owner_id: uuid,
  job_id: nullable(uuid),
  role: E.aiRole,
  provider: E.aiProvider,
  model: text(LIMITS.modelName),
  steps: int(0, 100),
  input_tokens: int(0, 2_000_000_000),
  output_tokens: int(0, 2_000_000_000),
  outcome: aiUsageOutcome,
  created_at: offsetDateTime,
});

// 資料表名稱與 row schema 對照，供一致性測試與 repository 使用
// T31：每個行程的 T-7、T-1 再核實各執行一次
export const reverifyRunRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  kind: z.enum(["T-7", "T-1"]),
  job_id: nullable(uuid),
  created_at: offsetDateTime,
});

// T32：邀請連結（只保存 token 的 SHA-256）
export const tripInvitationRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  role: z.enum(["companion", "viewer"]),
  token_hash: z.string().regex(/^[0-9a-f]{64}$/),
  created_by: uuid,
  expires_at: offsetDateTime,
  accepted_by: nullable(uuid),
  accepted_at: nullable(offsetDateTime),
  revoked_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

// T36：Morning Check 的結果
export const morningCheckRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  date: isoDate,
  result: z.record(z.string(), z.unknown()),
  checked_by: uuid,
  created_at: offsetDateTime,
});

// T41：旅後記憶提案（MEM-03、MEM-04），擁有者批准後才寫入 memories
export const memoryProposalRow = z.strictObject({
  id: uuid,
  owner_id: uuid,
  trip_id: uuid,
  layer: E.memoryLayer,
  kind: E.memoryKind,
  item: text(LIMITS.nameZh),
  value: text(LIMITS.shortNote),
  unit: nullable(text(20)),
  reason: text(300),
  status: E.memoryProposalStatus,
  decided_at: nullable(offsetDateTime),
  created_at: offsetDateTime,
});

export const tableSchemas = {
  profiles: profileRow,
  trips: tripRow,
  trip_members: tripMemberRow,
  trip_baselines: tripBaselineRow,
  itinerary_items: itineraryItemRow,
  days: dayRow,
  mobility_segments: mobilitySegmentRow,
  proposals: proposalRow,
  versions: versionRow,
  incidents: incidentRow,
  actual_timeline_entries: actualTimelineRow,
  notifications: notificationRow,
  memories: memoryRow,
  memory_proposals: memoryProposalRow,
  api_key_records: apiKeyRecordRow,
  readonly_links: readonlyLinkRow,
  background_jobs: backgroundJobRow,
  photos: photoRow,
  zones: zoneRow,
  reverify_runs: reverifyRunRow,
  trip_invitations: tripInvitationRow,
  morning_checks: morningCheckRow,
  feature_flags: featureFlagRow,
  ai_role_settings: aiRoleSettingRow,
  ai_usage: aiUsageRow,
  member_sensitive_fields: memberSensitiveFieldRow,
} as const;

export type TableName = keyof typeof tableSchemas;
export type Row<T extends TableName> = z.infer<(typeof tableSchemas)[T]>;
