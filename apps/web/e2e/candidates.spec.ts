import { expect, test, type Page } from "@playwright/test";
import { applyScoresAsAdmin, applySegmentAsAdmin, applyZoningAsAdmin, confirmTripAsAdmin, createTrip, seedResearchCandidates, signInAsNewUser, verifyCandidateAsAdmin } from "./support/auth";

// T24：Candidate List 與 AI／網頁內容的安全呈現（S-08、S-16）。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string, task = "T24") {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/${task}-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

// 清單每項一行，點進去才看詳情（docs/verification/ux-logic-2026-11-27.md）
async function openCandidate(page: Page, tripId: string, name: string) {
  await page.goto(`/trips/${tripId}/candidates`);
  await page.getByRole("list", { name: "候選" }).getByRole("link", { name: new RegExp(name) }).click();
  const article = page.getByRole("article", { name, exact: true });
  await article.waitFor();
  return article;
}

const source = (url: string) => ({ url, fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" });
const candidate = (over: Record<string, unknown>) => ({
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  recommendation_reason: "早上**人少**，[官網](https://www.senso-ji.jp/) 有開放時間",
  suggested_stay_minutes: 60,
  constraint_note: null,
  sources: [source("https://www.senso-ji.jp/")],
  generated_by: { provider: "anthropic", model: "claude-opus-5-5" },
  place_id: "ChIJ_senso_e2e",
  ...over,
});

test("Candidate List 依研究方向顯示；script、事件屬性與 javascript: 連結不會執行", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [candidate({})]);
  await seedResearchCandidates(tripId, owner.userId, "B", [
    candidate({
      name_zh: "測試咖啡",
      name_local: null,
      type: "restaurant",
      recommendation_reason:
        '<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2"> [按我](javascript:window.__xss=3) [舊站](http://example.com/)',
      constraint_note: "週三公休",
      sources: [source("https://cafe.example/")],
      place_id: null,
    }),
  ]);

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto(`/trips/${tripId}/candidates`);
  await expect(page.getByRole("heading", { name: "候選", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "候選" }).getByRole("listitem")).toHaveText([/景點淺草寺Unverified/, /餐飲測試咖啡Unverified/]);

  const senso = await openCandidate(page, tripId, "淺草寺");
  await expect(senso).toContainText("Research A：主要景點");
  await expect(senso.getByText("Unverified")).toBeVisible();
  await expect(senso.getByText("已對應")).toBeVisible();
  await expect(senso.locator("dl.scores dt")).toHaveCount(8);
  const official = senso.getByRole("link", { name: "官網" });
  await expect(official).toHaveAttribute("href", "https://www.senso-ji.jp/");
  await expect(official).toHaveAttribute("rel", "noopener noreferrer");

  const cafe = await openCandidate(page, tripId, "測試咖啡");
  await expect(cafe).toContainText("Research B：餐飲");
  await expect(cafe.getByText("未對應")).toBeVisible();
  await expect(cafe.getByText("週三公休")).toBeVisible();
  // 標籤以文字顯示，沒有產生元素；不安全的連結只留文字
  await expect(cafe.getByText("<script>window.__xss = 1</script>", { exact: false })).toBeVisible();
  await expect(cafe.locator("script, img, iframe")).toHaveCount(0);
  await expect(cafe.getByRole("link", { name: "按我" })).toHaveCount(0);
  await expect(cafe.getByRole("link", { name: "舊站" })).toHaveCount(0);
  await expect(cafe.getByText("按我")).toBeVisible();
  for (const link of await cafe.locator("a").all()) {
    expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "list");
});

test("E4：交叉核查後顯示採用的官方營業時間；無法判定的事實標示 Conflict", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [candidate({})]);
  await seedResearchCandidates(tripId, owner.userId, "B", [candidate({ name_zh: "測試咖啡", name_local: null, type: "restaurant", place_id: null })]);
  const gemini = { provider: "google", model: "gemini-model" };
  const official = source("https://www.senso-ji.jp/");
  await verifyCandidateAsAdmin(tripId, owner.userId, "淺草寺", {
    status: "verified",
    facts: [{ field: "opening_hours", status: "resolved", value: "09:00–17:00", grade: "facility_official" }],
    claims: [{ field: "opening_hours", value: "09:00–17:00", source: official, by: gemini }],
    sources: [official],
    verifiedBy: gemini,
  });
  await verifyCandidateAsAdmin(tripId, owner.userId, "測試咖啡", {
    status: "conflict",
    facts: [{ field: "opening_hours", status: "conflict", value: null, grade: "reliable_third_party" }],
    claims: [],
    sources: [],
    verifiedBy: gemini,
  });

  const senso = await openCandidate(page, tripId, "淺草寺");
  await expect(senso.getByText("Verified", { exact: true })).toBeVisible();
  await expect(senso.getByText("營業時間：09:00–17:00（設施官方）")).toBeVisible();
  await expect(senso.getByText(/Gemini（gemini-model）核實/)).toBeVisible();
  const cafe = await openCandidate(page, tripId, "測試咖啡");
  await expect(cafe.getByText("Conflict", { exact: true })).toBeVisible();
  await expect(cafe.getByText("營業時間：來源不一致，無法判定")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "verified", "T25");
});

test("T26：每個候選顯示八個篩選維度的評分與 Primary 或 Backup", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [candidate({}), candidate({ name_zh: "雷門", name_local: "雷門", place_id: null })]);
  await applyScoresAsAdmin(tripId, owner.userId, {
    淺草寺: { role: "primary", scores: [5, 3, 5, 5, 5, 3, 3, 5] },
    雷門: { role: "backup", scores: [3, 2, 5, 5, 5, 3, 4, 1] },
  });

  const senso = await openCandidate(page, tripId, "淺草寺");
  await expect(senso.locator("dl.facts")).toContainText("Primary");
  const kaminarimon = await openCandidate(page, tripId, "雷門");
  await expect(kaminarimon.locator("dl.facts")).toContainText("Backup");
  const scores = kaminarimon.locator("dl.scores > div");
  await expect(scores).toHaveCount(8);
  await expect(scores.nth(0)).toHaveText("個人價值3");
  await expect(scores.nth(7)).toHaveText("替代性1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "screening", "T26");
});

test("T27：候選顯示分區與由出發地前往的轉乘次數；主要區域有 Backup", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [
    candidate({ name_zh: "乙地", name_local: null, area: "乙區", place_id: null }),
    candidate({ name_zh: "新宿御苑", name_local: null, area: "新宿", place_id: null }),
    candidate({ name_zh: "甲地", name_local: null, area: "甲區", place_id: null }),
  ]);
  await applyZoningAsAdmin(
    tripId,
    owner.userId,
    [
      { name: "新宿與直達沿線", base_area: "新宿", items: [{ name: "新宿御苑", transfers: 0, minutes: 10 }, { name: "乙地", transfers: 0, minutes: 25 }] },
      { name: "甲區", base_area: null, items: [{ name: "甲地", transfers: 2, minutes: 35 }] },
    ],
    ["新宿御苑"],
  );

  await expect((await openCandidate(page, tripId, "乙地")).locator("dl.facts")).toContainText("新宿與直達沿線（估算：轉乘 0 次，約 25 分鐘）");
  await expect((await openCandidate(page, tripId, "甲地")).locator("dl.facts")).toContainText("甲區（估算：轉乘 2 次，約 35 分鐘）");
  await expect((await openCandidate(page, tripId, "新宿御苑")).locator("dl.facts")).toContainText("Backup");
  // 篩選 Backup 只列出新宿御苑
  await page.goto(`/trips/${tripId}/candidates?filter=backup`);
  await expect(page.getByRole("list", { name: "候選" }).getByRole("listitem")).toHaveText([/新宿御苑/]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "zoning", "T27");
});

test("T28：每段顯示四種方案、含緩衝的估算時間與來源，並以 Google Maps 開啟對應路段", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [candidate({}), candidate({ name_zh: "上野公園", name_local: "上野恩賜公園", area: "上野", place_id: null })]);
  const mapsUrl = "https://www.google.com/maps/dir/?api=1&origin=%E6%B5%85%E8%8D%89%E5%AF%BA&destination=%E4%B8%8A%E9%87%8E%E6%81%A9%E8%B3%9C%E5%85%AC%E5%9C%92&travelmode=transit";
  const est = (mode: string, minutes: number, transfers: number, price: number | null, comfort: string) => ({
    mode,
    door_to_door_minutes: minutes,
    price: price === null ? null : { amount: price, currency: "JPY" },
    walk_minutes: mode === "walk" ? minutes : 5,
    transfers,
    luggage_friendliness: "medium",
    comfort,
    delay_risk: "low",
    source_urls: ["https://railway.example.jp/route"],
    buffer_minutes: 10 + 5 * transfers,
    total_minutes: minutes + 10 + 5 * transfers,
  });
  await applySegmentAsAdmin(tripId, owner.userId, "淺草寺", "上野公園", {
    estimates: [est("walk", 30, 0, null, "low"), est("rail", 12, 1, 180, "medium"), est("taxi", 10, 0, 1500, "high")],
    buffer_minutes: 15,
    recommended_mode: "rail",
    plans: { recommended: "rail", fastest: "taxi", cheapest: "walk", comfortable: "taxi" },
    source_urls: ["https://railway.example.jp/route"],
    maps_url: mapsUrl,
  });

  // 交通動線比較在起點或終點候選的詳情
  await openCandidate(page, tripId, "淺草寺");
  const segment = page.getByRole("article", { name: "淺草寺到上野公園" });
  await expect(segment.getByText("四種方案（估算，含固定緩衝）")).toBeVisible();
  const rows = segment.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("推薦鐵路與地鐵約 27 分鐘（含緩衝 15 分鐘）約 180 JPY1 次");
  await expect(rows.nth(1)).toContainText("最快計程車與叫車約 20 分鐘");
  await expect(rows.nth(2)).toContainText("最便宜步行約 40 分鐘（含緩衝 10 分鐘）免費");
  await expect(segment.getByRole("link", { name: "https://railway.example.jp/route" })).toBeVisible();
  const maps = segment.getByRole("link", { name: "在 Google Maps 確認這段路線" });
  await expect(maps).toHaveAttribute("rel", "noopener noreferrer");
  const href = new URL((await maps.getAttribute("href")) ?? "");
  expect(href.searchParams.get("origin")).toBe("浅草寺");
  expect(href.searchParams.get("destination")).toBe("上野恩賜公園");
  await expect(page.getByText(/全部為 AI 依官方資料的估算/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "transport", "T28");
});

test("沒有 Research 的 API key 時不能開始研究；基線未確認與 Viewer 看不到按鈕", async ({ page, context, baseURL, browser }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const viewerContext = await browser.newContext();
  const viewer = await signInAsNewUser(viewerContext, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪三日", [{ userId: viewer.userId, role: "viewer" }]);

  await page.goto(`/trips/${tripId}/candidates`);
  await expect(page.getByText("確認 Trip Baseline v1 後才能開始研究。")).toBeVisible();
  await expect(page.getByRole("button", { name: "開始研究" })).toHaveCount(0);

  await confirmTripAsAdmin(tripId);
  await page.reload();
  await page.getByRole("button", { name: "開始研究" }).click();
  await expect(page.getByRole("status")).toHaveText("尚未設定 Claude 的 API key");
  await expect(page.getByText("還沒有候選。")).toBeVisible();

  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(`/trips/${tripId}/candidates`);
  await expect(viewerPage.getByRole("heading", { name: "候選", level: 1 })).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "開始研究" })).toHaveCount(0);
  await viewerContext.close();
});
