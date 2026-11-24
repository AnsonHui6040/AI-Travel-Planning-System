import { z } from "zod";

// 第 2.4–2.8 節的固定選項。資料庫以同名 enum type 定義。

export const itemType = z.enum(["attraction", "restaurant", "shopping", "photography", "activity"]);
export const constraintClass = z.enum(["hard_constraint", "strong_preference", "flexible"]);
export const level3 = z.enum(["low", "medium", "high"]);
export const reservationRequirement = z.enum(["none", "recommended", "required"]);
export const candidateRole = z.enum(["primary", "backup"]);
export const verificationStatus = z.enum(["verified", "partially_verified", "unverified", "conflict"]);
export const sourceGrade = z.enum([
  "facility_official",
  "official_transport_tourism",
  "reliable_third_party",
  "user_reviews",
]);
export const aiProvider = z.enum(["anthropic", "google", "openai"]);
export const lifecycleStatus = z.enum([
  "candidate",
  "pending_verification",
  "verified",
  "draft",
  "approved",
  "locked",
  "change_proposed",
  "modified",
  "rejected",
  "completed",
  "cancelled",
]);
export const postTripStatus = z.enum(["completed", "skipped", "cancelled", "revisit", "not_recommended"]);
export const tripStatus = z.enum(["baseline", "planning", "locked", "in_progress", "ended", "archived"]);
export const dayStatus = z.enum(["draft", "approved", "day_ready", "in_progress", "completed"]);
export const proposalStatus = z.enum(["pending", "applied", "rejected", "invalidated"]);
export const versionKind = z.enum(["major", "minor"]);
export const incidentLevel = z.enum(["L1", "L2", "L3", "L4"]);
export const transportMode = z.enum(["walk", "rail", "bus", "taxi", "drive"]);
export const aiRole = z.enum(["research", "verification", "transport", "master_planner", "live_planner"]);
export const memoryLayer = z.enum(["personal", "planning_rules", "trip_context"]);
export const memoryKind = z.enum(["constraint", "preference"]);
export const memorySource = z.enum(["manual", "post_trip_proposal"]);
export const keyProvider = z.enum(["anthropic", "google_ai", "openai", "google_maps", "odpt"]);
export const jobStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export const photoSource = z.enum(["user_upload", "wikimedia_commons"]);
// T24：Research A（主要景點與官方資訊）、B（餐飲、咖啡、購物）、C（攝影、日出日落、夜景、季節活動）、D（冷門替代）
export const researchTrack = z.enum(["A", "B", "C", "D"]);
// T25：交叉核查的事實欄位：營業時間、休館日、門票、預約、交通服務
export const factField = z.enum(["opening_hours", "closed_days", "admission", "reservation", "transport_service"]);
export const factStatus = z.enum(["resolved", "conflict"]);
export const completion = z.enum(["completed", "partial", "skipped"]);
