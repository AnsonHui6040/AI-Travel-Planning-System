import { describe, expect, it } from "vitest";
import {
  MembersStoreError,
  acceptInviteAction,
  changeRoleAction,
  createInviteAction,
  createReadonlyLinkAction,
  leaveTripAction,
  removeMemberAction,
  revokeInviteAction,
  revokeReadonlyLinkAction,
  type MembersDeps,
} from "./members-core";

// T32：邀請、角色變更、移除成員。權限由資料庫（RLS 與函式）判斷；這裡檢查登入、速率限制、參數與錯誤訊息

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const USER = "3b1e9c2d-7f4a-4c8b-a2d1-0f9e8d7c6b5a";
const INVITE = "5c6d7e8f-1a2b-4c3d-8e4f-0a1b2c3d4e5f";
const TOKEN = "a".repeat(64);

function deps(over: Partial<MembersDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: MembersDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    siteUrl: "https://trip.example",
    createInvite: async (...args) => {
      calls.push(["createInvite", ...args]);
      return TOKEN;
    },
    revokeInvite: async (...args) => {
      calls.push(["revokeInvite", ...args]);
    },
    acceptInvite: async (...args) => {
      calls.push(["acceptInvite", ...args]);
      return TRIP;
    },
    changeRole: async (...args) => {
      calls.push(["changeRole", ...args]);
      return 1;
    },
    createReadonlyLink: async (...args) => {
      calls.push(["createReadonlyLink", ...args]);
      return TOKEN;
    },
    revokeReadonlyLink: async (...args) => {
      calls.push(["revokeReadonlyLink", ...args]);
    },
    removeMember: async (...args) => {
      calls.push(["removeMember", ...args]);
      return 1;
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

const reject = (reason: "forbidden" | "invalid" | "unknown") => async () => {
  throw new MembersStoreError(reason);
};

describe("邀請", () => {
  it("Owner 建立邀請連結，連結只在建立時顯示一次", async () => {
    const { d, calls } = deps();
    expect(await createInviteAction(d, TRIP, "companion")).toEqual({
      ok: true,
      message: "已建立 Companion 邀請連結，7 天內有效，只能使用一次",
      link: `https://trip.example/invite/${TOKEN}`,
    });
    expect(calls).toEqual([["createInvite", TRIP, "companion"]]);
  });

  it("角色只能是 Companion 或 Viewer；非 Owner 被拒", async () => {
    const { d, calls } = deps();
    expect((await createInviteAction(d, TRIP, "owner")).message).toBe("角色不正確");
    expect(calls).toEqual([]);
    expect((await createInviteAction(deps({ createInvite: reject("forbidden") }).d, TRIP, "viewer")).message).toBe("只有 Owner 可以邀請成員");
  });

  it("撤銷邀請", async () => {
    const { d, calls } = deps();
    expect(await revokeInviteAction(d, INVITE)).toEqual({ ok: true, message: "已撤銷邀請連結" });
    expect(calls).toEqual([["revokeInvite", INVITE]]);
    expect((await revokeInviteAction(d, "x")).message).toBe("邀請不正確");
  });

  it("接受邀請後回傳行程；無效或已是成員時說明", async () => {
    const { d } = deps();
    expect(await acceptInviteAction(d, TOKEN)).toEqual({ ok: true, message: "已加入行程", tripId: TRIP });
    expect((await acceptInviteAction(d, "not-a-token")).message).toBe("邀請連結無效或已過期");
    expect((await acceptInviteAction(deps({ acceptInvite: reject("invalid") }).d, TOKEN)).message).toBe("邀請連結無效或已過期，或你已經是成員");
  });
});

describe("角色變更與移除", () => {
  it("Owner 變更角色；沒有變更任何列時視為沒有權限", async () => {
    const { d, calls } = deps();
    expect(await changeRoleAction(d, TRIP, USER, "viewer")).toEqual({ ok: true, message: "已變更角色為 Viewer" });
    expect(calls).toEqual([["changeRole", TRIP, USER, "viewer"]]);
    expect((await changeRoleAction(deps({ changeRole: async () => 0 }).d, TRIP, USER, "viewer")).message).toBe("只有 Owner 可以變更其他成員的角色");
    expect((await changeRoleAction(d, TRIP, USER, "owner")).message).toBe("角色不正確，轉移 Owner 請使用轉移功能");
  });

  it("Owner 移除成員", async () => {
    const { d, calls } = deps();
    expect(await removeMemberAction(d, TRIP, USER)).toEqual({ ok: true, message: "已移除成員，並刪除其在此行程的敏感欄位與記憶" });
    expect(calls).toEqual([["removeMember", TRIP, USER]]);
    expect((await removeMemberAction(deps({ removeMember: async () => 0 }).d, TRIP, USER)).message).toBe("無法移除這位成員");
  });

  it("自行退出；Owner 須先轉移 Owner 或刪除行程", async () => {
    const { d, calls } = deps();
    expect(await leaveTripAction(d, TRIP)).toEqual({ ok: true, message: "已退出行程" });
    expect(calls).toEqual([["removeMember", TRIP, "me"]]);
    expect((await leaveTripAction(deps({ removeMember: async () => 0 }).d, TRIP)).message).toBe("Owner 須先轉移 Owner 或刪除行程才能退出");
  });

  it("未登入、速率限制、參數不正確時不呼叫資料庫；其他錯誤只記錄", async () => {
    expect((await removeMemberAction(deps({ getUser: async () => null }).d, TRIP, USER)).message).toBe("需要登入");
    expect((await removeMemberAction(deps({ checkRateLimit: async () => false }).d, TRIP, USER)).message).toBe("操作過於頻繁，請稍後再試");
    const { d, calls } = deps();
    expect((await removeMemberAction(d, "x", USER)).message).toBe("參數不正確");
    expect(calls).toEqual([]);
    const broken = deps({ removeMember: reject("unknown") });
    expect((await removeMemberAction(broken.d, TRIP, USER)).message).toBe("操作失敗，請稍後再試");
    expect(broken.logs).toEqual(["成員管理失敗"]);
  });
});

describe("唯讀連結（T33）", () => {
  it("Owner 建立 7 天或 30 天的唯讀連結，連結只顯示一次", async () => {
    const { d, calls } = deps();
    expect(await createReadonlyLinkAction(d, TRIP, "30")).toEqual({
      ok: true,
      message: "已建立唯讀連結，30 天內有效；任何拿到連結的人不必登入即可檢視",
      link: `https://trip.example/r/${TOKEN}`,
    });
    expect(calls).toEqual([["createReadonlyLink", TRIP, 30]]);
    expect((await createReadonlyLinkAction(d, TRIP, "45")).message).toBe("期限不正確");
    expect((await createReadonlyLinkAction(deps({ createReadonlyLink: reject("forbidden") }).d, TRIP, "7")).message).toBe(
      "只有 Owner 可以建立唯讀連結",
    );
  });

  it("撤銷唯讀連結", async () => {
    const { d, calls } = deps();
    expect(await revokeReadonlyLinkAction(d, INVITE)).toEqual({ ok: true, message: "已撤銷唯讀連結" });
    expect(calls).toEqual([["revokeReadonlyLink", INVITE]]);
    expect((await revokeReadonlyLinkAction(d, "x")).message).toBe("連結不正確");
  });
});
