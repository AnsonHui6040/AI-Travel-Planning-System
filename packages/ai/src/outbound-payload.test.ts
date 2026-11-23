import type { ProviderAdapter, ProviderRequest } from "@atps/core";
import { buildAiPayload, payloadFixtures, serializeAiPayload, type AiPayloadInput, type SensitiveEntry } from "@atps/security";
import { describe, expect, it } from "vitest";
import { createAnthropicAdapter, createGeminiAdapter, createOpenAIAdapter, type ProviderOptions } from "./index";
import { fakeFetch, type Step } from "./testing/fake-fetch";
import { anthropicFixtures, geminiFixtures, openaiFixtures } from "./testing/fixtures";

// T17 PASS：開關關閉時，三家 outbound payload 快照不含該欄位值（S-07）；也不含 Google Maps 內容（S-17）
const { fullItem, fullTrip, MEMBER_A, MEMBER_B } = payloadFixtures;

const SENSITIVE = {
  full_name: "王小明",
  phone: "+886 912-345-678",
  email: "ming@example.test",
} as const;

const entries = (shareAi: boolean): SensitiveEntry[] =>
  (Object.entries(SENSITIVE) as [SensitiveEntry["field"], string][]).map(([field, value]) => ({ userId: MEMBER_A, field, value, shareAi }));

const payloadInput = (sensitive: SensitiveEntry[]): AiPayloadInput => ({
  trip: fullTrip,
  members: [
    { userId: MEMBER_A, role: "owner", displayName: "小明" },
    { userId: MEMBER_B, role: "companion", displayName: "美華" },
  ],
  sensitive,
  items: [{ ...fullItem, payer_id: MEMBER_A }],
});

const request = (input: string): ProviderRequest => ({
  model: "fixture-model",
  system: "你是行程規劃員。",
  input,
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  tools: [],
  maxTokens: 2000,
});

const PROVIDERS: { name: string; create: (o: ProviderOptions) => ProviderAdapter; structured: Step }[] = [
  { name: "anthropic", create: createAnthropicAdapter, structured: anthropicFixtures.structured },
  { name: "gemini", create: createGeminiAdapter, structured: geminiFixtures.structured },
  { name: "openai", create: createOpenAIAdapter, structured: openaiFixtures.structured },
];

async function outbound(provider: (typeof PROVIDERS)[number], sensitive: SensitiveEntry[]): Promise<string> {
  const fake = fakeFetch([provider.structured]);
  const adapter = provider.create({ fetch: fake.fetch, maxRetries: 0, timeoutMs: 5_000 });
  const input = serializeAiPayload(buildAiPayload(payloadInput(sensitive)));
  await adapter.generate(request(input), { kind: "api_key", secret: "test-only-key-value-0001" });
  expect(fake.requests).toHaveLength(1);
  return JSON.stringify(fake.requests[0]?.body);
}

describe.each(PROVIDERS)("outbound payload：$name", (provider) => {
  it("開關全部關閉：請求不含任何敏感欄位值，符合快照", async () => {
    const body = await outbound(provider, entries(false));
    for (const value of Object.values(SENSITIVE)) expect(body).not.toContain(value);
    expect(body).toMatchSnapshot();
  });

  it("開啟「提供給 AI」：只帶出開啟的欄位", async () => {
    const sensitive = entries(false).map((e) => (e.field === "email" ? { ...e, shareAi: true } : e));
    const body = await outbound(provider, sensitive);
    expect(body).toContain(SENSITIVE.email);
    expect(body).not.toContain(SENSITIVE.full_name);
    expect(body).not.toContain(SENSITIVE.phone);
  });

  it("不含 Google Maps 內容與使用者編號", async () => {
    const body = await outbound(provider, entries(true));
    for (const value of [fullItem.place_id, fullItem.address, fullItem.name_local, String(fullItem.coord_lat), String(fullItem.coord_lng), MEMBER_A, MEMBER_B]) {
      expect(body).not.toContain(value);
    }
  });
});
