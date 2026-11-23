import { describe, expect, it } from "vitest";
import {
  checkCredentialProvider,
  checkDataSourceAdapter,
  checkProviderAdapter,
  checkRegionPack,
  checkRoleSpec,
  isFeatureEnabled,
  scopeMemories,
  type CredentialProvider,
  type DataSourceAdapter,
  type FeatureFlag,
  type Memory,
  type ProviderAdapter,
  type RegionPack,
  type RoleSpec,
} from "./index";

const provider: ProviderAdapter = {
  id: "fake-ai",
  authMethods: ["api_key"],
  builtInSearch: true,
  generate: async () => ({ output: {}, usage: { inputTokens: 1, outputTokens: 1 }, citations: [] }),
  classifyError: (error) =>
    typeof error === "object" && error !== null && "status" in error && error.status === 429 ? "rate_limit" : "unknown",
};

const role: RoleSpec = {
  id: "fake_role",
  tools: ["provider_search"],
  output: { safeParse: () => ({ success: true }) },
  maxSteps: 10,
  maxTokens: 20_000,
  dataScope: ["candidates"],
  memoryScope: { layers: ["personal"], kinds: ["constraint"] },
};

const dataSource: DataSourceAdapter = {
  id: "fake-weather",
  capabilities: ["weather", "alert"],
  regions: ["JP"],
  fetchHosts: ["api.example.com"],
  query: async (request) => ({
    capability: request.capability,
    data: {},
    retrievedAt: new Date(0),
    source: { name: "假天氣", url: "https://api.example.com/" },
  }),
};

const region: RegionPack = {
  id: "ZZ",
  timeZone: "Asia/Tokyo",
  currency: "JPY",
  languages: ["ja", "en"],
  transitStatusSources: [{ id: "rail", name: "假鐵路", url: "https://rail.example.jp/status" }],
  weatherAlertSources: [{ id: "jma", name: "假氣象", url: "https://weather.example.jp/" }],
  officialSiteAllowlist: ["rail.example.jp", "weather.example.jp"],
};

const credential: CredentialProvider = {
  kind: "api_key",
  available: true,
  resolve: async () => null,
};

describe("ProviderAdapter 契約", () => {
  it("合格的 adapter 沒有問題", () => {
    expect(checkProviderAdapter(provider)).toEqual([]);
  });

  it("id 格式、認證方式、錯誤分類不合格時列出問題", () => {
    expect(checkProviderAdapter({ ...provider, id: "Bad ID" })).not.toEqual([]);
    expect(checkProviderAdapter({ ...provider, authMethods: [] })).not.toEqual([]);
    expect(checkProviderAdapter({ ...provider, authMethods: ["api_key", "api_key"] })).not.toEqual([]);
    expect(
      checkProviderAdapter({ ...provider, authMethods: ["password" as unknown as "api_key"] }),
    ).not.toEqual([]);
    expect(checkProviderAdapter({ ...provider, classifyError: () => "boom" as unknown as "unknown" })).not.toEqual(
      [],
    );
    expect(
      checkProviderAdapter({
        ...provider,
        classifyError: () => {
          throw new Error("x");
        },
      }),
    ).not.toEqual([]);
  });
});

describe("RoleSpec 契約", () => {
  it("合格的角色沒有問題", () => {
    expect(checkRoleSpec(role)).toEqual([]);
  });

  it("步數與 token 上限必須是正整數且不超過上限（S-06）", () => {
    expect(checkRoleSpec({ ...role, maxSteps: 0 })).not.toEqual([]);
    expect(checkRoleSpec({ ...role, maxSteps: 1.5 })).not.toEqual([]);
    expect(checkRoleSpec({ ...role, maxSteps: 101 })).not.toEqual([]);
    expect(checkRoleSpec({ ...role, maxTokens: 0 })).not.toEqual([]);
    expect(checkRoleSpec({ ...role, maxTokens: 1_000_001 })).not.toEqual([]);
  });

  it("工具只能取自固定清單，不得重複（S-04）", () => {
    expect(checkRoleSpec({ ...role, tools: ["write_memory" as unknown as "provider_search"] })).not.toEqual([]);
    expect(checkRoleSpec({ ...role, tools: ["provider_search", "provider_search"] })).not.toEqual([]);
  });

  it("必須有輸出 schema，記憶範圍與資料範圍只能取自固定清單", () => {
    expect(checkRoleSpec({ ...role, output: {} as unknown as RoleSpec["output"] })).not.toEqual([]);
    expect(
      checkRoleSpec({ ...role, memoryScope: { layers: ["all" as unknown as "personal"], kinds: [] } }),
    ).not.toEqual([]);
    expect(checkRoleSpec({ ...role, dataScope: ["everything" as unknown as "candidates"] })).not.toEqual([]);
  });
});

describe("DataSourceAdapter 契約", () => {
  it("合格的 adapter 沒有問題", () => {
    expect(checkDataSourceAdapter(dataSource)).toEqual([]);
    expect(checkDataSourceAdapter({ ...dataSource, regions: "global", fetchHosts: [] })).toEqual([]);
  });

  it("必須宣告至少一項已知能力", () => {
    expect(checkDataSourceAdapter({ ...dataSource, capabilities: [] })).not.toEqual([]);
    expect(
      checkDataSourceAdapter({ ...dataSource, capabilities: ["stocks" as unknown as "weather"] }),
    ).not.toEqual([]);
  });

  it("fetch 主機只能是主機名稱，不含協定或路徑", () => {
    expect(checkDataSourceAdapter({ ...dataSource, fetchHosts: ["https://api.example.com"] })).not.toEqual([]);
    expect(checkDataSourceAdapter({ ...dataSource, fetchHosts: ["api.example.com/path"] })).not.toEqual([]);
  });
});

describe("RegionPack 契約", () => {
  it("合格的地區 pack 沒有問題", () => {
    expect(checkRegionPack(region)).toEqual([]);
  });

  it("時區、幣別、語言格式錯誤時列出問題", () => {
    expect(checkRegionPack({ ...region, timeZone: "Mars/Base" })).not.toEqual([]);
    expect(checkRegionPack({ ...region, currency: "yen" })).not.toEqual([]);
    expect(checkRegionPack({ ...region, languages: [] })).not.toEqual([]);
    expect(checkRegionPack({ ...region, languages: ["日本語"] })).not.toEqual([]);
    expect(checkRegionPack({ ...region, id: "japan" })).not.toEqual([]);
  });

  it("來源必須是 https，且主機在官方網站白名單內", () => {
    expect(
      checkRegionPack({
        ...region,
        transitStatusSources: [{ id: "rail", name: "假鐵路", url: "http://rail.example.jp/" }],
      }),
    ).not.toEqual([]);
    expect(
      checkRegionPack({
        ...region,
        weatherAlertSources: [{ id: "x", name: "其他", url: "https://other.example.com/" }],
      }),
    ).not.toEqual([]);
    expect(checkRegionPack({ ...region, officialSiteAllowlist: ["https://rail.example.jp"] })).not.toEqual([]);
  });
});

describe("CredentialProvider 契約", () => {
  it("api_key 與 plan_oauth 都可以註冊", () => {
    expect(checkCredentialProvider(credential)).toEqual([]);
    expect(checkCredentialProvider({ ...credential, kind: "plan_oauth", available: false })).toEqual([]);
  });

  it("不認識的認證方式列出問題", () => {
    expect(checkCredentialProvider({ ...credential, kind: "cookie" as unknown as "api_key" })).not.toEqual([]);
  });
});

const memory = (layer: Memory["layer"], kind: Memory["kind"], item: string) =>
  ({ layer, kind, item }) as unknown as Memory;

describe("記憶範圍（MEM-11）", () => {
  it("只保留角色記憶範圍內的層級與類型", () => {
    const all = [
      memory("personal", "constraint", "步行上限"),
      memory("personal", "preference", "喜歡寺廟"),
      memory("planning_rules", "constraint", "每日最晚回飯店"),
      memory("trip_context", "preference", "這趟想看紅葉"),
    ];
    expect(scopeMemories(all, { layers: ["personal"], kinds: ["constraint"] }).map((m) => m.item)).toEqual([
      "步行上限",
    ]);
    expect(
      scopeMemories(all, { layers: ["personal", "trip_context"], kinds: ["constraint", "preference"] }).map(
        (m) => m.item,
      ),
    ).toEqual(["步行上限", "喜歡寺廟", "這趟想看紅葉"]);
  });

  it("記憶範圍為空時不送出任何記憶", () => {
    expect(scopeMemories([memory("personal", "constraint", "x")], { layers: [], kinds: [] })).toEqual([]);
  });
});

describe("feature flag（F-05）", () => {
  const flags: FeatureFlag[] = [
    { key: "expense_ledger", enabled: true },
    { key: "calendar_export", enabled: false },
  ];

  it("只有明確開啟的功能回傳 true", () => {
    expect(isFeatureEnabled(flags, "expense_ledger")).toBe(true);
    expect(isFeatureEnabled(flags, "calendar_export")).toBe(false);
  });

  it("未登記的功能預設關閉", () => {
    expect(isFeatureEnabled(flags, "push_notifications")).toBe(false);
    expect(isFeatureEnabled([], "expense_ledger")).toBe(false);
  });
});
