import { defaultRegions } from "@atps/regions";
import { FETCH_ALLOWLIST } from "@atps/security";
import { describe, expect, it } from "vitest";

// T20、S-05：地區 pack 的官方網站白名單必須已經 PR 加入白名單 fetch 的設定檔，
// Verification 才能讀取（D30）。設定檔只能經 PR 修改，所以兩者不一致時 CI 失敗。
describe("地區白名單與白名單 fetch 設定檔一致", () => {
  it.each(defaultRegions().list().map((p) => [p.id, p] as const))("%s 的官方網站全部在 fetch-allowlist.json", (_id, pack) => {
    for (const host of pack.officialSiteAllowlist) expect(FETCH_ALLOWLIST).toContain(host);
  });

  it("fetch-allowlist.json 沒有任何地區都沒用到的主機", () => {
    const used = new Set(defaultRegions().list().flatMap((p) => p.officialSiteAllowlist));
    expect(FETCH_ALLOWLIST.filter((h) => !used.has(h))).toEqual([]);
  });
});
