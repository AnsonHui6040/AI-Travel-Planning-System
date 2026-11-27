import { expect, test, type Page } from "@playwright/test";
import {
  applyScoresAsAdmin,
  applySegmentAsAdmin,
  applyZoningAsAdmin,
  confirmTripAsAdmin,
  createTrip,
  markBaselineConfirmedAsAdmin,
  saveBaselineAsAdmin,
  seedResearchCandidates,
  setAvailabilityAsAdmin,
  signInAsNewUser,
  verifyCandidateAsAdmin,
} from "./support/auth";

// T29：每日時段草案與行程 Card；T30：可行性驗證、批准與鎖定。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

const source = { url: "https://www.example.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" };
const candidate = (name: string, type = "attraction") => ({
  name_zh: name,
  name_local: null,
  area: "淺草",
  type,
  recommendation_reason: "測試",
  suggested_stay_minutes: 60,
  constraint_note: null,
  sources: [source],
  generated_by: { provider: "anthropic", model: "claude-opus-5-5" },
  place_id: null,
});
const gemini = { provider: "google", model: "gemini-model" };

test("依排程順序排入，每項一行；項目詳情顯示到達、停留、下一站、交通、狀態、可移動範圍", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京一日");
  await saveBaselineAsAdmin(tripId, {
    start_date: "2026-12-01",
    end_date: "2026-12-01",
    timezone: "Asia/Tokyo",
    flights: [],
    lodgings: [],
    companions: 1,
    stamina_note: null,
    budget: null,
    fixed_activities: [{ name: "和服體驗", area: "淺草", date: "2026-12-01", start: "13:00", end: "15:00", paid: true }],
    paid_items: [],
    must_visit: [],
    excluded: [],
    transport_preferences: [],
    photography_needs: null,
  });
  await markBaselineConfirmedAsAdmin(tripId);
  await confirmTripAsAdmin(tripId);
  await seedResearchCandidates(tripId, owner.userId, "A", [
    candidate("淺草寺"),
    candidate("雷門"),
    candidate("咖啡店", "restaurant"),
    candidate("未核實景點"),
    candidate("定休喫茶", "restaurant"),
  ]);
  for (const [name, status] of [["淺草寺", "verified"], ["雷門", "partially_verified"], ["咖啡店", "verified"], ["定休喫茶", "verified"]] as const) {
    await verifyCandidateAsAdmin(tripId, owner.userId, name, { status, facts: [], claims: [], sources: [], verifiedBy: gemini });
  }
  await applyScoresAsAdmin(tripId, owner.userId, {
    淺草寺: { role: "primary", scores: [5, 3, 5, 5, 5, 3, 4, 5] },
    雷門: { role: "primary", scores: [3, 3, 5, 5, 5, 3, 4, 3] },
    咖啡店: { role: "primary", scores: [3, 3, 5, 5, 5, 5, 4, 3] },
    定休喫茶: { role: "primary", scores: [3, 3, 5, 5, 5, 5, 4, 3] },
  });
  // T30：2026-12-01 是星期二；定休喫茶只在星期五營業（E3）
  await setAvailabilityAsAdmin(tripId, owner.userId, "定休喫茶", [{ weekday: 5, start: "10:00", end: "18:00" }]);
  await applyZoningAsAdmin(tripId, owner.userId, [
    {
      name: "淺草",
      base_area: null,
      items: [
        { name: "淺草寺", transfers: 1, minutes: 30 },
        { name: "雷門", transfers: 1, minutes: 31 },
        { name: "咖啡店", transfers: 1, minutes: 32 },
        { name: "未核實景點", transfers: 1, minutes: 33 },
        { name: "定休喫茶", transfers: 1, minutes: 34 },
      ],
    },
  ]);
  await applySegmentAsAdmin(tripId, owner.userId, "淺草寺", "雷門", {
    estimates: [
      {
        mode: "walk",
        door_to_door_minutes: 5,
        price: null,
        walk_minutes: 5,
        transfers: 0,
        luggage_friendliness: "medium",
        comfort: "medium",
        delay_risk: "low",
        source_urls: ["https://www.example.jp/"],
        buffer_minutes: 10,
        total_minutes: 15,
      },
    ],
    buffer_minutes: 10,
    recommended_mode: "walk",
    plans: { recommended: "walk", fastest: "walk", cheapest: "walk", comfortable: "walk" },
    source_urls: ["https://www.example.jp/"],
    maps_url: "https://www.google.com/maps/dir/?api=1&destination=x&travelmode=walking",
  });

  await page.goto(`/trips/${tripId}/days`);
  await expect(page.getByRole("heading", { name: "行程", level: 1 })).toBeVisible();
  const day = page.getByRole("region", { name: "2026-12-01" });
  const rows = day.getByRole("list", { name: "項目" }).getByRole("listitem");
  // 淺草寺與雷門先排高優先；咖啡店在午餐時段放不下（到固定活動需交通加 15 分鐘緩衝），改排晚餐時段
  const order = await rows.allTextContents();
  expect(order).toEqual(["09:00淺草寺Verified", "10:15雷門Partially Verified", "13:00和服體驗固定活動", "17:30咖啡店Verified"]);
  // T30：當天公休的候選不排入，留在 Candidate List（E3）；Unverified 不排入
  await expect(rows.filter({ hasText: "定休喫茶" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "未核實景點" })).toHaveCount(0);
  await expect(day).toContainText("1 個項目留在 Candidate List");
  await expect(day).toContainText("定休喫茶（當天休館或公休）");
  await expect(day.getByText("草案", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "T30-draft");

  // 項目詳情：到達、停留、下一站、交通、狀態、可移動範圍
  await rows.filter({ hasText: "淺草寺" }).getByRole("link").click();
  const senso = page.getByRole("article", { name: "淺草寺" });
  await expect(senso.getByRole("heading", { name: "淺草寺", level: 1 })).toBeVisible();
  await expect(senso).toContainText("時間09:00–10:00");
  await expect(senso).toContainText("停留60 分鐘");
  await expect(senso).toContainText("下一站雷門");
  await expect(senso).toContainText("交通步行約 15 分鐘（估算，含緩衝）");
  await expect(senso).toContainText("Verified");
  await expect(senso).toContainText("可移動範圍09:00–09:00 開始");
  await expect(senso.getByRole("link", { name: "照片" })).toHaveAttribute("href", /\/items\/[0-9a-f-]{36}\/photos$/);
  await capture(page, "T30-item");
  await page.goBack();

  // T30：批准唯一的一天後行程鎖定
  await day.getByRole("button", { name: /^批准/ }).click();
  await expect(day.getByRole("status")).toHaveText("已批准 2026-12-01，所有日期都已批准，行程已鎖定");
  await page.reload();
  await expect(page.locator(".trip-line")).toHaveText("東京一日（已鎖定）");
  const locked = page.getByRole("region", { name: "2026-12-01" });
  const lockedRows = locked.getByRole("list", { name: "項目" }).getByRole("listitem");
  await expect(locked.getByText("已批准", { exact: true })).toBeVisible();
  await expect(locked.getByRole("button", { name: /^批准/ })).toHaveCount(0);
  expect(await lockedRows.allTextContents()).toEqual(order);

  // 鎖定後新研究只進 Candidate List
  await seedResearchCandidates(tripId, owner.userId, "B", [candidate("鎖定後的新候選")]);
  await page.reload();
  await expect(lockedRows.filter({ hasText: "鎖定後的新候選" })).toHaveCount(0);
  expect(await lockedRows.allTextContents()).toEqual(order);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "T30-locked");
});

test("基線未確認時不產生草案", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪三日");
  await page.goto(`/trips/${tripId}/days`);
  await expect(page.getByText("確認 Trip Baseline v1 後才能產生每日草案。")).toBeVisible();
});
