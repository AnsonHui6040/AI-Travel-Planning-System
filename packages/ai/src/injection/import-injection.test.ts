import { defaultRoleSetting, gateImportOutput, runRole, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import { FETCH_ALLOWLIST, buildImportPayload, composeRoleInput } from "@atps/security";
import { describe, expect, it } from "vitest";
import { importSpec } from "../index";
import { FAKE_KEY, IMPORT_CASES, IMPORT_MEMBER, type ImportInjectionCase } from "./cases";

// 決策 0010 I：行程匯入的 prompt injection 回歸測試（S-01、S-03、S-07）。
// 與伺服器（apps/web/lib/server/import-core.ts）相同的步驟：移除個資 → 資料區塊 → 以 Master Planner 設定執行 → gateImportOutput。
// 匯入沒有寫入去處：結果只有預覽或被拒

const NONCE = "f1e2d3c4b5a69788";
const FORBIDDEN = [FAKE_KEY, ...Object.values(IMPORT_MEMBER)];
const ALLOWLIST_BEFORE = [...FETCH_ALLOWLIST];

async function run(c: ImportInjectionCase) {
  const requests: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    id: "fake",
    authMethods: ["api_key"],
    builtInSearch: false,
    generate: async (request) => {
      requests.push(request);
      return { output: c.modelOutput, usage: { inputTokens: 500, outputTokens: 100 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const payload = buildImportPayload(c.pasted, { knownValues: Object.values(IMPORT_MEMBER) });
  const input = composeRoleInput("行程匯入：整理預訂與地點。", [{ kind: "pasted_text", content: payload.text }], { nonce: NONCE });
  const result = await runRole(
    { adapterFor: () => adapter, credentialFor: async () => ({ kind: "api_key", secret: FAKE_KEY }), recordUsage: async () => {} },
    { role: importSpec(), setting: defaultRoleSetting("master_planner"), input, ownerId: "owner", jobId: null },
  );
  const outcome =
    result.status === "completed"
      ? gateImportOutput(result.output, { forbiddenValues: FORBIDDEN })
      : { ok: false as const, reason: result.status === "output_invalid" ? "output_invalid" : result.status, detail: "" };
  return { outcome, requests, input };
}

describe("行程匯入的 prompt injection 回歸測試", () => {
  it("至少 3 筆，編號不重複，被拒的案例都有預期原因", () => {
    expect(IMPORT_CASES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(IMPORT_CASES.map((c) => c.id)).size).toBe(IMPORT_CASES.length);
    expect(IMPORT_CASES.filter((c) => c.expect === "rejected").every((c) => c.reason !== undefined)).toBe(true);
  });

  describe.each(IMPORT_CASES)("$id $title", (c) => {
    it(`結果為 ${c.expect}，沒有洩漏，貼上的內容只在資料區塊內`, async () => {
      const { outcome, requests, input } = await run(c);

      expect(requests.length).toBeGreaterThanOrEqual(1);
      for (const request of requests) {
        const sent = JSON.stringify(request);
        for (const value of [...FORBIDDEN, "912-345-678"]) expect(sent).not.toContain(value);
        expect(request.tools).toEqual([]);
      }
      // 只有一個真正的資料區塊；偽造的標記被中和
      expect(input.match(new RegExp(`\\[資料開始 ${NONCE}\\]`, "g"))).toHaveLength(1);
      expect(input.match(new RegExp(`\\[資料結束 ${NONCE}\\]`, "g"))).toHaveLength(1);
      expect(input).not.toMatch(/^\[資料結束 0000000000000000\]/m);
      expect(input.indexOf("[資料開始 " + NONCE)).toBeLessThan(input.indexOf(c.pasted.split("\n")[0]?.replace(/\[資料/g, "［資料").slice(0, 8) ?? ""));

      if (c.expect === "rejected") expect(outcome).toMatchObject({ ok: false, reason: c.reason });
      else expect(outcome).toMatchObject({ ok: true });
      for (const value of FORBIDDEN) expect(JSON.stringify(outcome)).not.toContain(value);
      expect([...FETCH_ALLOWLIST]).toEqual(ALLOWLIST_BEFORE);
    });
  });
});
