import { uuid } from "@atps/schemas";

// T32：邀請、角色變更、移除成員的 Server Action 邏輯（SH-01、SH-02、SH-07）。
// 權限由資料庫判斷：邀請與撤銷經函式（只限 Owner）、加入只經 accept_trip_invitation（受邀者本人），
// 角色變更與移除以使用者 session 執行並受 RLS 限制（只有 Owner；不可改為或移除 Owner；可自行退出）。
// 移除後的資料清除（敏感欄位、行程記憶、通知）由資料庫 trigger 處理。

export class MembersStoreError extends Error {
  constructor(readonly reason: "forbidden" | "invalid" | "unknown") {
    super(`成員管理失敗（${reason}）`);
  }
}

export type InviteRole = "companion" | "viewer";

export interface MembersDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  // 邀請連結的網址開頭（SITE_URL）
  siteUrl: string;
  createInvite: (tripId: string, role: InviteRole) => Promise<string>;
  revokeInvite: (invitationId: string) => Promise<void>;
  acceptInvite: (token: string) => Promise<string>;
  // 回傳受影響的列數（RLS 擋下時為 0）
  changeRole: (tripId: string, userId: string, role: InviteRole) => Promise<number>;
  removeMember: (tripId: string, userId: string) => Promise<number>;
  // T33：唯讀連結（只限 Owner，期限 1–30 天）
  createReadonlyLink: (tripId: string, days: number) => Promise<string>;
  revokeReadonlyLink: (linkId: string) => Promise<void>;
  logError: (message: string) => void;
}

export interface MembersActionResult {
  ok: boolean;
  message: string;
  link?: string;
  tripId?: string;
}

const RATE = { endpoint: "members.write", limit: 30, windowSeconds: 60 } as const;
const ROLE_LABELS: Record<InviteRole, string> = { companion: "Companion", viewer: "Viewer" };
const isRole = (value: unknown): value is InviteRole => value === "companion" || value === "viewer";
const TOKEN = /^[0-9a-f]{64}$/;

async function run(
  deps: MembersDeps,
  forbidden: string,
  task: (user: { id: string }) => Promise<MembersActionResult>,
  invalid = "內容不正確",
): Promise<MembersActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  try {
    return await task(user);
  } catch (error) {
    if (error instanceof MembersStoreError && error.reason === "forbidden") return { ok: false, message: forbidden };
    if (error instanceof MembersStoreError && error.reason === "invalid") return { ok: false, message: invalid };
    deps.logError("成員管理失敗");
    return { ok: false, message: "操作失敗，請稍後再試" };
  }
}

export function createInviteAction(deps: MembersDeps, tripIdRaw: unknown, roleRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "只有 Owner 可以邀請成員", async () => {
    const tripId = uuid.safeParse(tripIdRaw);
    if (!tripId.success) return { ok: false, message: "行程不正確" };
    if (!isRole(roleRaw)) return { ok: false, message: "角色不正確" };
    const token = await deps.createInvite(tripId.data, roleRaw);
    return {
      ok: true,
      message: `已建立 ${ROLE_LABELS[roleRaw]} 邀請連結，7 天內有效，只能使用一次`,
      link: `${deps.siteUrl.replace(/\/$/, "")}/invite/${token}`,
    };
  });
}

export function revokeInviteAction(deps: MembersDeps, invitationRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "只有 Owner 可以撤銷邀請", async () => {
    const id = uuid.safeParse(invitationRaw);
    if (!id.success) return { ok: false, message: "邀請不正確" };
    await deps.revokeInvite(id.data);
    return { ok: true, message: "已撤銷邀請連結" };
  });
}

export function acceptInviteAction(deps: MembersDeps, tokenRaw: unknown): Promise<MembersActionResult> {
  return run(
    deps,
    "需要登入",
    async () => {
      if (typeof tokenRaw !== "string" || !TOKEN.test(tokenRaw)) return { ok: false, message: "邀請連結無效或已過期" };
      const tripId = await deps.acceptInvite(tokenRaw);
      return { ok: true, message: "已加入行程", tripId };
    },
    "邀請連結無效或已過期，或你已經是成員",
  );
}

export function changeRoleAction(deps: MembersDeps, tripIdRaw: unknown, userIdRaw: unknown, roleRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "只有 Owner 可以變更其他成員的角色", async () => {
    const tripId = uuid.safeParse(tripIdRaw);
    const userId = uuid.safeParse(userIdRaw);
    if (!tripId.success || !userId.success) return { ok: false, message: "參數不正確" };
    if (!isRole(roleRaw)) return { ok: false, message: "角色不正確，轉移 Owner 請使用轉移功能" };
    const changed = await deps.changeRole(tripId.data, userId.data, roleRaw);
    if (changed === 0) return { ok: false, message: "只有 Owner 可以變更其他成員的角色" };
    return { ok: true, message: `已變更角色為 ${ROLE_LABELS[roleRaw]}` };
  });
}

export function removeMemberAction(deps: MembersDeps, tripIdRaw: unknown, userIdRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "無法移除這位成員", async () => {
    const tripId = uuid.safeParse(tripIdRaw);
    const userId = uuid.safeParse(userIdRaw);
    if (!tripId.success || !userId.success) return { ok: false, message: "參數不正確" };
    if ((await deps.removeMember(tripId.data, userId.data)) === 0) return { ok: false, message: "無法移除這位成員" };
    return { ok: true, message: "已移除成員，並刪除其在此行程的敏感欄位與記憶" };
  });
}

export function leaveTripAction(deps: MembersDeps, tripIdRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "無法退出行程", async (user) => {
    const tripId = uuid.safeParse(tripIdRaw);
    if (!tripId.success) return { ok: false, message: "參數不正確" };
    if ((await deps.removeMember(tripId.data, user.id)) === 0) return { ok: false, message: "Owner 須先轉移 Owner 或刪除行程才能退出" };
    return { ok: true, message: "已退出行程" };
  });
}

const READONLY_DAYS = new Set([7, 30]);

export function createReadonlyLinkAction(deps: MembersDeps, tripIdRaw: unknown, daysRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "只有 Owner 可以建立唯讀連結", async () => {
    const tripId = uuid.safeParse(tripIdRaw);
    if (!tripId.success) return { ok: false, message: "行程不正確" };
    const days = typeof daysRaw === "string" ? Number(daysRaw) : NaN;
    if (!READONLY_DAYS.has(days)) return { ok: false, message: "期限不正確" };
    const token = await deps.createReadonlyLink(tripId.data, days);
    return {
      ok: true,
      message: `已建立唯讀連結，${days} 天內有效；任何拿到連結的人不必登入即可檢視`,
      link: `${deps.siteUrl.replace(/\/$/, "")}/r/${token}`,
    };
  });
}

export function revokeReadonlyLinkAction(deps: MembersDeps, linkRaw: unknown): Promise<MembersActionResult> {
  return run(deps, "只有 Owner 可以撤銷唯讀連結", async () => {
    const id = uuid.safeParse(linkRaw);
    if (!id.success) return { ok: false, message: "連結不正確" };
    await deps.revokeReadonlyLink(id.data);
    return { ok: true, message: "已撤銷唯讀連結" };
  });
}
