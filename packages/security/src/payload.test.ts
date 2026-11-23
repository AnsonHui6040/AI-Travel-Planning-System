import { describe, expect, it } from "vitest";
import { AI_ITEM_FIELDS, AI_TRIP_FIELDS, buildAiPayload, type AiPayloadInput } from "./index";
import { fullItem, fullTrip, MEMBER_A, MEMBER_B } from "./testing/payload-fixtures";

// T17、S-07：送往 AI 的 payload 由 allowlist builder 產生
const input = (overrides: Partial<AiPayloadInput> = {}): AiPayloadInput => ({
  trip: fullTrip,
  members: [
    { userId: MEMBER_A, role: "owner", displayName: "小明" },
    { userId: MEMBER_B, role: "companion", displayName: null },
  ],
  sensitive: [],
  items: [fullItem],
  ...overrides,
});

describe("buildAiPayload", () => {
  it("行程與項目只輸出 allowlist 內的欄位", () => {
    const payload = buildAiPayload(input());
    expect(Object.keys(payload.trip).sort()).toEqual([...AI_TRIP_FIELDS].sort());
    for (const item of payload.items) {
      expect(Object.keys(item).every((key) => (AI_ITEM_FIELDS as readonly string[]).includes(key))).toBe(true);
    }
  });

  it("不含 Google Maps 內容與內部欄位（S-17）", () => {
    const text = JSON.stringify(buildAiPayload(input()));
    for (const value of [fullItem.place_id, fullItem.address, String(fullItem.coord_lat), fullItem.name_local, fullTrip.owner_id, MEMBER_A, MEMBER_B]) {
      expect(text).not.toContain(value);
    }
    for (const key of ["place_id", "address", "coord_lat", "coord_lng", "name_local", "owner_id", "trip_id", "user_id", "generated_by", "verified_by"]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it("成員以內部代號識別，付款人對應到代號", () => {
    const payload = buildAiPayload(input({ items: [{ ...fullItem, payer_id: MEMBER_B }] }));
    expect(payload.members.map((m) => m.ref)).toEqual(["M1", "M2"]);
    expect(payload.items[0]?.payer).toBe("M2");
  });

  it("未開啟「提供給 AI」的敏感欄位不出現", () => {
    const payload = buildAiPayload(
      input({
        sensitive: [
          { userId: MEMBER_A, field: "full_name", value: "王小明", shareAi: false },
          { userId: MEMBER_A, field: "phone", value: "+886 912-345-678", shareAi: false },
        ],
      }),
    );
    const text = JSON.stringify(payload);
    expect(text).not.toContain("王小明");
    expect(text).not.toContain("912-345-678");
    expect(payload.members[0]).toEqual({ ref: "M1", role: "owner", displayName: "小明" });
  });

  it("開啟「提供給 AI」的欄位只附在當事人底下", () => {
    const payload = buildAiPayload(input({ sensitive: [{ userId: MEMBER_B, field: "email", value: "hua@example.test", shareAi: true }] }));
    expect(payload.members[1]).toEqual({ ref: "M2", role: "companion", displayName: null, email: "hua@example.test" });
    expect(payload.members[0]).not.toHaveProperty("email");
  });

  it("不屬於成員的敏感欄位不出現", () => {
    const text = JSON.stringify(
      buildAiPayload(input({ sensitive: [{ userId: "00000000-0000-4000-8000-0000000000ff", field: "full_name", value: "外人", shareAi: true }] })),
    );
    expect(text).not.toContain("外人");
  });

  it("輸入物件多出的欄位不會被帶出", () => {
    const sneaky = { ...fullItem, api_key: "sk-ant-should-not-leak" } as typeof fullItem;
    expect(JSON.stringify(buildAiPayload(input({ items: [sneaky] })))).not.toContain("sk-ant-should-not-leak");
  });
});
