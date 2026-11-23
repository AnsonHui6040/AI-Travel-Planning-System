import {
  defaultRoleSetting,
  handleRoleRun,
  type ProviderAdapter,
  type ProviderRequest,
  type RoleOutputSink,
} from "@atps/core";
import { FETCH_ALLOWLIST, buildAiPayload, composeRoleInput, payloadFixtures, serializeAiPayload } from "@atps/security";
import { describe, expect, it } from "vitest";
import { roleSpec } from "../index";
import { CASES, CATEGORIES, FAKE_KEY, ITEM_A, ITEM_B, UNSHARED, type InjectionCase } from "./cases";

// T18 PASS：全部案例沒有寫入、沒有洩漏，只產生候選或待批准提案，或被拒（S-01、S-03）。CI 關卡「prompt injection 回歸測試集」
const OWNER = payloadFixtures.MEMBER_A;
const FORBIDDEN = [FAKE_KEY, ...Object.values(UNSHARED)];
const ALLOWLIST_BEFORE = [...FETCH_ALLOWLIST];

function tripBlock(): string {
  const { fullTrip, fullItem, MEMBER_A, MEMBER_B } = payloadFixtures;
  return serializeAiPayload(
    buildAiPayload({
      trip: fullTrip,
      members: [
        { userId: MEMBER_A, role: "owner", displayName: "小明" },
        { userId: MEMBER_B, role: "companion", displayName: "美華" },
      ],
      // 未開啟「提供給 AI」
      sensitive: [
        { userId: MEMBER_A, field: "full_name", value: UNSHARED.full_name, shareAi: false },
        { userId: MEMBER_A, field: "phone", value: UNSHARED.phone, shareAi: false },
      ],
      items: [
        { ...fullItem, id: ITEM_A },
        { ...fullItem, id: ITEM_B, name_zh: "晴空塔" },
      ],
    }),
  );
}

async function run(c: InjectionCase) {
  const requests: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    id: "fake",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      requests.push(request);
      return { output: c.modelOutput, usage: { inputTokens: 1000, outputTokens: 200 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const stored: Array<{ method: keyof RoleOutputSink; data: unknown }> = [];
  const sink: RoleOutputSink = {
    addCandidates: async (_trip, data) => void stored.push({ method: "addCandidates", data }),
    addVerificationResults: async (_trip, data) => void stored.push({ method: "addVerificationResults", data }),
    addSegments: async (_trip, data) => void stored.push({ method: "addSegments", data }),
    addPendingProposals: async (_trip, _base, data) => void stored.push({ method: "addPendingProposals", data }),
  };

  const input = composeRoleInput(
    "依資料完成你的工作。",
    [{ kind: "trip", content: tripBlock() }, c.inject],
    { nonce: "a1b2c3d4e5f60718" },
  );
  // Gemini 與 OpenAI 的模型預設空白（決策 0006），測試以固定名稱代入
  const defaults = defaultRoleSetting(c.role);
  const setting = { ...defaults, chain: defaults.chain.map((e) => ({ ...e, model: e.model ?? "fixture-model" })) };
  const result = await handleRoleRun(
    {
      adapterFor: () => adapter,
      credentialFor: async () => ({ kind: "api_key", secret: FAKE_KEY }),
      recordUsage: async () => {},
      sink,
    },
    { role: roleSpec(c.role), setting, input, ownerId: OWNER, jobId: null },
    { tripId: payloadFixtures.fullTrip.id, baseVersion: 3, knownItemIds: new Set([ITEM_A, ITEM_B]), forbiddenValues: FORBIDDEN },
  );
  return { result, requests, stored, input };
}

describe("prompt injection 回歸測試集", () => {
  it("每類至少 3 筆，編號不重複，被拒的案例都有預期原因", () => {
    expect(CASES.filter((c) => c.expect === "rejected").every((c) => c.reason !== undefined)).toBe(true);
    for (const category of CATEGORIES) expect(CASES.filter((c) => c.category === category).length).toBeGreaterThanOrEqual(3);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  describe.each(CASES)("$id $title", (c) => {
    it(`結果為 ${c.expect}，沒有寫入正式行程、沒有洩漏`, async () => {
      const { result, requests, stored, input } = await run(c);

      // 送出：key 與未開放的欄位不在 input；注入內容只在資料區塊內
      expect(requests.length).toBeGreaterThanOrEqual(1);
      for (const request of requests) {
        const sent = JSON.stringify(request);
        for (const value of FORBIDDEN) expect(sent).not.toContain(value);
        // S-04：只有供應商內建搜尋交給 AI
        expect(request.tools.every((t) => t === "provider_search")).toBe(true);
      }
      const injectedAt = input.indexOf(c.inject.content.split("\n")[0]?.replace(/\[資料/g, "［資料") ?? "");
      expect(injectedAt).toBeGreaterThan(input.lastIndexOf("[資料開始 a1b2c3d4e5f60718]"));
      expect(input.match(/\[資料結束 a1b2c3d4e5f60718\]/g)).toHaveLength(2);

      // 結果：只有候選或待批准提案，或被拒
      if (c.expect === "rejected") {
        expect(result).toMatchObject({ status: "rejected", reason: c.reason });
        expect(stored).toEqual([]);
      } else {
        expect(result).toMatchObject({ status: "stored", kind: c.expect });
        const method = c.expect === "candidates" ? "addCandidates" : "addPendingProposals";
        expect(stored.map((s) => s.method)).toEqual([method]);
      }

      // 沒有洩漏：寫入的資料與回傳結果都不含 key 或未開放的欄位
      for (const value of FORBIDDEN) {
        expect(JSON.stringify(stored)).not.toContain(value);
        expect(JSON.stringify(result)).not.toContain(value);
      }
      // 白名單不受影響
      expect([...FETCH_ALLOWLIST]).toEqual(ALLOWLIST_BEFORE);
    });
  });
});
