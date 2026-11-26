import { describe, expect, it } from "vitest";
import { createTripAction, sendMagicLinkAction, type EntryDeps } from "./entry-core";

// 進入 App：Email magic link 登入（D05）與建立行程

function deps(over: Partial<EntryDeps> = {}) {
  const sent: unknown[] = [];
  const created: unknown[] = [];
  const logs: string[] = [];
  const d: EntryDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    origin: "http://localhost:3000",
    sendMagicLink: async (email, redirectTo) => {
      sent.push([email, redirectTo]);
    },
    createTrip: async (trip) => {
      created.push(trip);
      return "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, sent, created, logs };
}

describe("sendMagicLinkAction", () => {
  it("寄出登入連結，回呼只導向站內路徑", async () => {
    const { d, sent } = deps();
    expect(await sendMagicLinkAction(d, { email: " Me@Example.test ", next: "/trips" })).toEqual({ ok: true, message: "已寄出登入連結，請到信箱開啟" });
    expect(sent).toEqual([["me@example.test", "http://localhost:3000/auth/callback?next=%2Ftrips"]]);
  });

  it("外部網址的 next 改為首頁（避免開放式重新導向）", async () => {
    const { d, sent } = deps();
    await sendMagicLinkAction(d, { email: "me@example.test", next: "https://evil.example/x" });
    expect(sent).toEqual([["me@example.test", "http://localhost:3000/auth/callback?next=%2F"]]);
  });

  it("電子郵件格式不正確時不寄出", async () => {
    const { d, sent } = deps();
    expect(await sendMagicLinkAction(d, { email: "not-an-email", next: "" })).toEqual({ ok: false, message: "請輸入正確的電子郵件" });
    expect(sent).toEqual([]);
  });

  it("寄送失敗不外洩細節", async () => {
    const { d, logs } = deps({ sendMagicLink: async () => Promise.reject(new Error("smtp down for a@b.c")) });
    expect(await sendMagicLinkAction(d, { email: "me@example.test", next: "/" })).toEqual({ ok: false, message: "寄送失敗，請稍後再試" });
    expect(logs).toEqual(["登入連結寄送失敗"]);
  });
});

describe("createTripAction", () => {
  it("建立行程，擁有者為本人", async () => {
    const { d, created } = deps();
    expect(await createTripAction(d, { name: " 東京五日 ", destination: "東京" })).toEqual({
      ok: true,
      message: "已建立行程",
      tripId: "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab",
    });
    expect(created).toEqual([{ ownerId: "me", name: "東京五日", destination: "東京" }]);
  });

  it("目的地可留空；名稱必填且有長度上限", async () => {
    const { d, created } = deps();
    await createTripAction(d, { name: "週末", destination: "" });
    expect(created).toEqual([{ ownerId: "me", name: "週末", destination: null }]);
    expect((await createTripAction(d, { name: "", destination: "" })).message).toBe("請輸入行程名稱（120 字以內）");
    expect((await createTripAction(d, { name: "a".repeat(121), destination: "" })).message).toBe("請輸入行程名稱（120 字以內）");
  });

  it("需要登入並受速率限制", async () => {
    expect((await createTripAction(deps({ getUser: async () => null }).d, { name: "x" })).message).toBe("需要登入");
    expect((await createTripAction(deps({ checkRateLimit: async () => false }).d, { name: "x" })).message).toBe("操作過於頻繁，請稍後再試");
  });
});
