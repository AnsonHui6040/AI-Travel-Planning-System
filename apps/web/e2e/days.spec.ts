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
  signInAsNewUser,
  verifyCandidateAsAdmin,
} from "./support/auth";

// T29：每日時段草案與行程 Card。需本機 Supabase 與 apps/web/.env.local。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T29-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
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

test("依排程順序排入，行程 Card 顯示到達、停留、下一站、交通、狀態、可移動範圍", async ({ page, context, baseURL }) => {
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
  await seedResearchCandidates(tripId, owner.userId, "A", [candidate("淺草寺"), candidate("雷門"), candidate("咖啡店", "restaurant"), candidate("未核實景點")]);
  for (const [name, status] of [["淺草寺", "verified"], ["雷門", "partially_verified"], ["咖啡店", "verified"]] as const) {
    await verifyCandidateAsAdmin(tripId, owner.userId, name, { status, facts: [], claims: [], sources: [], verifiedBy: gemini });
  }
  await applyScoresAsAdmin(tripId, owner.userId, {
    淺草寺: { role: "primary", scores: [5, 3, 5, 5, 5, 3, 4, 5] },
    雷門: { role: "primary", scores: [3, 3, 5, 5, 5, 3, 4, 3] },
    咖啡店: { role: "primary", scores: [3, 3, 5, 5, 5, 5, 4, 3] },
  });
  await applyZoningAsAdmin(tripId, owner.userId, [
    {
      name: "淺草",
      base_area: null,
      items: [
        { name: "淺草寺", transfers: 1, minutes: 30 },
        { name: "雷門", transfers: 1, minutes: 31 },
        { name: "咖啡店", transfers: 1, minutes: 32 },
        { name: "未核實景點", transfers: 1, minutes: 33 },
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
  await expect(page.getByRole("heading", { name: "每日時段草案", level: 1 })).toBeVisible();
  const day = page.getByRole("region", { name: "2026-12-01" });
  // 淺草寺與雷門的優先度相同（總分 35、31 → 4），先排高優先；咖啡店排在午餐時段；固定活動 13:00
  const order = await day.locator("article.day-card h3, p.fixed-row").allTextContents();
  expect(order).toEqual(["淺草寺", "雷門", "咖啡店", "13:00–15:00 固定活動：和服體驗"]);

  const senso = day.getByRole("article", { name: "淺草寺" });
  await expect(senso).toContainText("到達09:00");
  await expect(senso).toContainText("停留60 分鐘");
  await expect(senso).toContainText("下一站雷門");
  await expect(senso).toContainText("交通步行約 15 分鐘（估算，含緩衝）");
  await expect(senso).toContainText("狀態Verified");
  await expect(senso).toContainText("可移動範圍09:00–09:00 開始");
  // 沒有照片時顯示名稱
  await expect(senso.locator(".photo-fallback")).toContainText("淺草寺");
  const kaminarimon = day.getByRole("article", { name: "雷門" });
  await expect(kaminarimon).toContainText("到達10:15");
  await expect(kaminarimon).toContainText("狀態Partially Verified");
  await expect(day.getByRole("article", { name: "咖啡店" })).toContainText("到達11:30");
  // Unverified 不排入
  await expect(day.getByRole("article", { name: "未核實景點" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "day");
});

test("基線未確認時不產生草案", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "大阪三日");
  await page.goto(`/trips/${tripId}/days`);
  await expect(page.getByText("確認 Trip Baseline v1 後才能產生每日草案。")).toBeVisible();
});
