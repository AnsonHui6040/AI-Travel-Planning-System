import { expect, test, type Page } from "@playwright/test";
import { confirmTripAsAdmin, createTrip, seedResearchCandidates, signInAsNewUser, verifyCandidateAsAdmin } from "./support/auth";

// T24：Candidate List 與 AI／網頁內容的安全呈現（S-08、S-16）。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string, task = "T24") {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/${task}-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
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
  await expect(page.getByRole("heading", { name: "Candidate List", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Research A：主要景點/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Research B：餐飲/ })).toBeVisible();

  const senso = page.getByRole("article", { name: "淺草寺" });
  await expect(senso.getByText("Unverified")).toBeVisible();
  await expect(senso.getByText("已對應")).toBeVisible();
  const official = senso.getByRole("link", { name: "官網" });
  await expect(official).toHaveAttribute("href", "https://www.senso-ji.jp/");
  await expect(official).toHaveAttribute("rel", "noopener noreferrer");

  const cafe = page.getByRole("article", { name: "測試咖啡" });
  await expect(cafe.getByText("未對應")).toBeVisible();
  await expect(cafe.getByText("週三公休")).toBeVisible();
  // 標籤以文字顯示，沒有產生元素；不安全的連結只留文字
  await expect(cafe.getByText("<script>window.__xss = 1</script>", { exact: false })).toBeVisible();
  await expect(cafe.locator("script, img, iframe")).toHaveCount(0);
  await expect(cafe.getByRole("link", { name: "按我" })).toHaveCount(0);
  await expect(cafe.getByRole("link", { name: "舊站" })).toHaveCount(0);
  await expect(cafe.getByText("按我")).toBeVisible();
  for (const link of await page.locator("main a").all()) {
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

  await page.goto(`/trips/${tripId}/candidates`);
  const senso = page.getByRole("article", { name: "淺草寺" });
  await expect(senso.getByText("Verified", { exact: true })).toBeVisible();
  await expect(senso.getByText("營業時間：09:00–17:00（設施官方）")).toBeVisible();
  await expect(senso.getByText(/Gemini（gemini-model）核實/)).toBeVisible();
  const cafe = page.getByRole("article", { name: "測試咖啡" });
  await expect(cafe.getByText("Conflict", { exact: true })).toBeVisible();
  await expect(cafe.getByText("營業時間：來源不一致，無法判定")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "verified", "T25");
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
  await expect(viewerPage.getByRole("heading", { name: "Candidate List", level: 1 })).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "開始研究" })).toHaveCount(0);
  await viewerContext.close();
});
