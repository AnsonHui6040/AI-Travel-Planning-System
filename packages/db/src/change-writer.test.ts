import { describe, expect, it } from "vitest";
import {
  SupabaseChangeWriter,
  SupabaseNotificationRepository,
  SupabaseVersionRestorer,
  type QueryClient,
  type RpcClient,
} from "./index";

const PROPOSAL = "40000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-0000000000b2";

function fakeRpc(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, unknown]> = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return result;
    },
  } as unknown as RpcClient;
  return { client, calls };
}

describe("SupabaseChangeWriter", () => {
  it("批准：呼叫 approve_proposal，回傳新版本與失效的同分支提案", async () => {
    const { client, calls } = fakeRpc({
      data: { outcome: "applied", major: 1, minor: 4, invalidated_ids: ["40000000-0000-4000-8000-000000000002"] },
      error: null,
    });
    const result = await new SupabaseChangeWriter(client).approve({ proposalId: PROPOSAL, actorId: MEMBER });
    expect(calls).toEqual([["approve_proposal", { p_proposal_id: PROPOSAL }]]);
    expect(result).toEqual({
      outcome: "applied",
      version: { major: 1, minor: 4 },
      invalidatedIds: ["40000000-0000-4000-8000-000000000002"],
    });
  });

  it("批准：版本已變更時回傳已失效", async () => {
    const { client } = fakeRpc({ data: { outcome: "invalidated" }, error: null });
    expect(await new SupabaseChangeWriter(client).approve({ proposalId: PROPOSAL, actorId: MEMBER })).toEqual({
      outcome: "invalidated",
    });
  });

  it("自動套用：呼叫 auto_apply_proposal", async () => {
    const { client, calls } = fakeRpc({ data: { outcome: "applied", major: 2, minor: 0, invalidated_ids: [] }, error: null });
    await new SupabaseChangeWriter(client).autoApply({ proposalId: PROPOSAL });
    expect(calls).toEqual([["auto_apply_proposal", { p_proposal_id: PROPOSAL }]]);
  });

  it("否決：呼叫 reject_proposal", async () => {
    const { client, calls } = fakeRpc({ data: null, error: null });
    await new SupabaseChangeWriter(client).reject({ proposalId: PROPOSAL, actorId: MEMBER });
    expect(calls).toEqual([["reject_proposal", { p_proposal_id: PROPOSAL }]]);
  });

  it("資料庫回傳錯誤時拋出，不洩漏錯誤內容", async () => {
    const { client } = fakeRpc({ data: null, error: { message: "permission denied for table secret" } });
    await expect(new SupabaseChangeWriter(client).approve({ proposalId: PROPOSAL, actorId: MEMBER })).rejects.toThrow(
      /^套用變更失敗$/,
    );
  });

  it("回傳格式不符時拋出", async () => {
    const { client } = fakeRpc({ data: { outcome: "applied" }, error: null });
    await expect(new SupabaseChangeWriter(client).approve({ proposalId: PROPOSAL, actorId: MEMBER })).rejects.toThrow();
  });
});

describe("SupabaseVersionRestorer（T10A）", () => {
  const VERSION = "50000000-0000-4000-8000-000000000001";
  const NEW_VERSION = "50000000-0000-4000-8000-000000000002";

  it("呼叫 restore_version，傳入版本編號與 base version", async () => {
    const { client, calls } = fakeRpc({
      data: { outcome: "restored", major: 3, minor: 0, version_id: NEW_VERSION },
      error: null,
    });
    const result = await new SupabaseVersionRestorer(client).restore({ versionId: VERSION, baseVersion: 5 });
    expect(calls).toEqual([["restore_version", { p_version_id: VERSION, p_base_version: 5 }]]);
    expect(result).toEqual({ version: { major: 3, minor: 0 }, versionId: NEW_VERSION });
  });

  it("資料庫回傳錯誤時拋出，不洩漏錯誤內容", async () => {
    const { client } = fakeRpc({ data: null, error: { message: "行程版本已變更" } });
    await expect(new SupabaseVersionRestorer(client).restore({ versionId: VERSION, baseVersion: 5 })).rejects.toThrow(
      /^復原版本失敗$/,
    );
  });

  it("回傳格式不符時拋出", async () => {
    const { client } = fakeRpc({ data: { outcome: "restored" }, error: null });
    await expect(new SupabaseVersionRestorer(client).restore({ versionId: VERSION, baseVersion: 5 })).rejects.toThrow();
  });
});

describe("SupabaseNotificationRepository：未讀紀錄（SH-06）", () => {
  const row = {
    id: "50000000-0000-4000-8000-000000000001",
    recipient_id: MEMBER,
    trip_id: "20000000-0000-4000-8000-000000000001",
    kind: "proposal_applied",
    ref_table: "proposals",
    ref_id: PROPOSAL,
    read_at: null,
    created_at: "2026-11-23T00:00:00+00:00",
  };

  function fakeQuery(result: { data: unknown; error: { message: string } | null }) {
    const calls: Array<[string, ...unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "update"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    const client = {
      from: (table: string) => {
        calls.push(["from", table]);
        return builder;
      },
    } as unknown as QueryClient;
    return { client, calls };
  }

  it("依成員列出未讀通知", async () => {
    const { client, calls } = fakeQuery({ data: [row], error: null });
    expect(await new SupabaseNotificationRepository(client).listUnread(MEMBER)).toEqual([row]);
    expect(calls).toEqual([
      ["from", "notifications"],
      ["select", "*"],
      ["eq", "recipient_id", MEMBER],
      ["is", "read_at", null],
      ["order", "created_at"],
    ]);
  });

  it("標示已讀只更新 read_at", async () => {
    const { client, calls } = fakeQuery({ data: null, error: null });
    await new SupabaseNotificationRepository(client).markRead(row.id, new Date("2026-11-23T01:00:00Z"));
    expect(calls).toEqual([
      ["from", "notifications"],
      ["update", { read_at: "2026-11-23T01:00:00.000Z" }],
      ["eq", "id", row.id],
    ]);
  });
});
