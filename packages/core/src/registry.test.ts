import { describe, expect, it } from "vitest";
import { createRegistry, RegistrationError } from "./index";

interface Entry {
  id: string;
  ok: boolean;
}

const make = () =>
  createRegistry<Entry>({
    kind: "測試擴充點",
    idOf: (e) => e.id,
    check: (e) => (e.ok ? [] : ["不符合契約"]),
  });

describe("註冊表", () => {
  it("通過契約的實作可以註冊並查詢", () => {
    const registry = make();
    registry.register({ id: "a", ok: true });
    registry.register({ id: "b", ok: true });
    expect(registry.get("a")).toEqual({ id: "a", ok: true });
    expect(registry.has("b")).toBe(true);
    expect(registry.list().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("不符合契約的實作不能註冊，並列出問題", () => {
    const registry = make();
    expect(() => registry.register({ id: "a", ok: false })).toThrow(RegistrationError);
    try {
      registry.register({ id: "a", ok: false });
    } catch (error) {
      expect((error as RegistrationError).issues).toEqual(["不符合契約"]);
    }
    expect(registry.has("a")).toBe(false);
  });

  it("相同 id 不能重複註冊", () => {
    const registry = make();
    registry.register({ id: "a", ok: true });
    expect(() => registry.register({ id: "a", ok: true })).toThrow(/重複/);
  });

  it("require 找不到時拋出錯誤，get 回傳 undefined", () => {
    const registry = make();
    expect(registry.get("x")).toBeUndefined();
    expect(() => registry.require("x")).toThrow(/找不到/);
  });

  it("list 回傳副本，外部修改不影響註冊表", () => {
    const registry = make();
    registry.register({ id: "a", ok: true });
    registry.list().pop();
    expect(registry.list()).toHaveLength(1);
  });
});
