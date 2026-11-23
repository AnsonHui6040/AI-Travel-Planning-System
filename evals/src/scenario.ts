import { z } from "zod";
import { AI_ROLES } from "@atps/core";
import { CHANGE_KINDS, hhmm, isoDate, uuid, type roleOutputs } from "@atps/schemas";

// T15：AI 評估場景格式（第 9.3 節）。場景檔在 evals/scenarios/<編號>.json

const tripItem = z.strictObject({
  id: uuid,
  name: z.string().min(1).max(120),
  // approved：已在行程；candidate：候選清單；其他狀態不可被排入
  status: z.enum(["approved", "candidate", "rejected", "conflict"]),
  date: isoDate.nullable(),
  start: hhmm.nullable(),
  end: hhmm.nullable(),
  paid: z.boolean().optional(),
});
export type TripItem = z.infer<typeof tripItem>;

const window = z
  .strictObject({ type: z.literal("within_window"), date: isoDate, from: hhmm, to: hhmm })
  .refine((w) => w.to > w.from, "時段結束須晚於開始");

export const judgeSpec = z.discriminatedUnion("type", [
  // 所有操作只涉及此時段：原本在此時段（或未排程）的項目，且新時段在此時段內或取消排程
  window,
  // 這些日期的項目不被改動，也沒有項目被移入
  z.strictObject({ type: z.literal("dates_unchanged"), dates: z.array(isoDate).min(1) }),
  // 這些項目不被重新排程（例如已付款活動）；標示 At Risk 不算
  z.strictObject({ type: z.literal("items_preserved"), itemIds: z.array(uuid).min(1) }),
  // 被排入的未排程項目必須來自候選清單
  z.strictObject({ type: z.literal("only_candidates") }),
  // 每個提案都需要使用者批准（第 2.6 節）
  z.strictObject({ type: z.literal("requires_approval") }),
  z.strictObject({ type: z.literal("change_kind"), allowed: z.array(z.enum(CHANGE_KINDS)).min(1) }),
  z
    .strictObject({ type: z.literal("proposal_count"), min: z.int().min(1), max: z.int().min(1) })
    .refine((c) => c.max >= c.min, "上限不可小於下限"),
]);
export type JudgeSpec = z.infer<typeof judgeSpec>;

// 判定器目前針對變更提案；其他角色的判定器隨對應場景加入
const PLANNER_ROLES = ["master_planner", "live_planner"] as const;

const scenarioSchema = z
  .strictObject({
    id: z.string().regex(/^E\d{1,2}$/),
    title: z.string().min(1).max(80),
    rule: z.string().min(1).max(200),
    role: z.enum(PLANNER_ROLES),
    // 第 9.1 節：每個場景連續執行 5 次，全部通過才算通過
    runs: z.int().min(1).max(20).default(5),
    instruction: z.string().min(1).max(2000),
    trip: z.strictObject({ items: z.array(tripItem).min(1).max(200) }),
    judges: z.array(judgeSpec).min(1).max(20),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.trip.items.map((i) => i.id));
    if (ids.size !== s.trip.items.length) ctx.addIssue({ code: "custom", message: "行程項目編號重複" });
    for (const judge of s.judges) {
      if (judge.type !== "items_preserved") continue;
      for (const id of judge.itemIds) {
        if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `判定器引用不存在的項目 ${id}` });
      }
    }
    if (!(AI_ROLES as readonly string[]).includes(s.role)) ctx.addIssue({ code: "custom", message: "不認識的角色" });
  });
export type Scenario = z.infer<typeof scenarioSchema>;

export const parseScenario = (value: unknown): Scenario => scenarioSchema.parse(value);

const recordingSchema = z.strictObject({
  scenario: z.string().regex(/^E\d{1,2}$/),
  note: z.string().min(1).max(500),
  // 不在此驗證內容：不合格的回應要由執行器判定（S-02）
  responses: z.array(z.unknown()).min(1).max(20),
});
export type Recording = z.infer<typeof recordingSchema>;

export const parseRecording = (value: unknown): Recording => recordingSchema.parse(value);

export type PlannerOutput = z.infer<(typeof roleOutputs)["live_planner"]>;
