import { uuid } from "@atps/schemas";

// T31：旅前自動再核實排程的開關（只有 Owner，由資料庫函式 set_reverify_schedule 檢查），
// 與成員開啟 App 時的未讀通知（SH-06；只能讀取、標記本人的通知，受 RLS 限制）。

export class InboxStoreError extends Error {
  constructor(readonly reason: "forbidden" | "unknown") {
    super(`寫入失敗（${reason}）`);
  }
}

export interface InboxDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  setReverify: (tripId: string, enabled: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
  logError: (message: string) => void;
}

export interface InboxActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "inbox.write", limit: 30, windowSeconds: 60 } as const;

async function guard(deps: InboxDeps): Promise<InboxActionResult | null> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  return null;
}

export async function setReverifyAction(deps: InboxDeps, tripIdRaw: unknown, valueRaw: unknown): Promise<InboxActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  const tripId = uuid.safeParse(tripIdRaw);
  if (!tripId.success) return { ok: false, message: "行程不正確" };
  if (valueRaw !== "on" && valueRaw !== "off") return { ok: false, message: "設定不正確" };
  const enabled = valueRaw === "on";
  try {
    await deps.setReverify(tripId.data, enabled);
    return { ok: true, message: enabled ? "已開啟旅前自動再核實" : "已關閉旅前自動再核實" };
  } catch (error) {
    if (error instanceof InboxStoreError && error.reason === "forbidden") return { ok: false, message: "只有 Owner 可以設定旅前自動再核實" };
    deps.logError("設定旅前再核實失敗");
    return { ok: false, message: "設定失敗，請稍後再試" };
  }
}

export async function markAllReadAction(deps: InboxDeps): Promise<InboxActionResult> {
  const blocked = await guard(deps);
  if (blocked) return blocked;
  try {
    await deps.markAllRead();
    return { ok: true, message: "已全部標為已讀" };
  } catch {
    deps.logError("標記通知失敗");
    return { ok: false, message: "標記失敗，請稍後再試" };
  }
}

const LABELS: Record<string, string> = {
  proposal_applied: "行程已更新",
  proposal_rejected: "提案已否決",
  proposal_invalidated: "提案已失效",
  day_approved: "有一天的行程已批准",
  trip_locked: "行程已鎖定",
  incident_started: "進入 Incident Mode，有替代方案待批准",
  timeline_produced: "已產生一天的 Actual Timeline",
};

export const notificationLabel = (kind: string): string => LABELS[kind] ?? "行程有新消息";
