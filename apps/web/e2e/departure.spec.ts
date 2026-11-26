import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, scheduleItemAsAdmin, signInAsNewUser } from "./support/auth";

// T37：離開前檢查。以 Playwright 的時鐘模擬旅行當天（東京時間），不需要外部資料。
// CAPTURE_SCREENSHOTS=1 時把截圖存到 docs/verification/screenshots/

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS !== "1") return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `../../docs/verification/screenshots/T37-${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

async function setup(page: Page, context: Parameters<typeof signInAsNewUser>[0], baseURL: string | undefined): Promise<string> {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京五日");
  const senso = await createItem(tripId, { name_zh: "淺草寺" });
  const kami = await createItem(tripId, { name_zh: "雷門" });
  await scheduleItemAsAdmin(tripId, senso, "2026-12-10", "09:00", "10:00");
  await scheduleItemAsAdmin(tripId, kami, "2026-12-10", "11:00", "12:00");
  return tripId;
}

test("準時：顯示最遲離開倒數與預計到達，照原定行程前往", async ({ page, context, baseURL }) => {
  const tripId = await setup(page, context, baseURL);
  await page.clock.install({ time: new Date("2026-12-10T10:00:00+09:00") });
  await page.goto(`/trips/${tripId}/today`);
  const first = page.getByRole("listitem", { name: "淺草寺" });
  await first.getByText("離開前檢查").click();
  const panel = first.locator("details.departure");
  await expect(panel).toContainText("現在10:00");
  await expect(panel).toContainText("最遲離開10:30（還有 30 分鐘）");
  await expect(panel).toContainText("預計到達雷門10:30");
  await expect(panel).toContainText("仍值得前往");
  await expect(panel).toContainText("照原定行程前往");
  await expect(panel).toContainText("沒有即時交通資料，以估算計算");
});

test("出現偏差（延誤 15 分鐘）時建議進入 Incident Mode（L1）", async ({ page, context, baseURL }) => {
  const tripId = await setup(page, context, baseURL);
  await page.clock.install({ time: new Date("2026-12-10T10:45:00+09:00") });
  await page.goto(`/trips/${tripId}/today`);
  const first = page.getByRole("listitem", { name: "淺草寺" });
  await expect(first).toContainText("最遲 10:30 離開前往雷門（已超過 15 分鐘）");
  await first.getByText("離開前檢查").click();
  const panel = first.locator("details.departure");
  await expect(panel).toContainText("預計到達雷門11:15（延誤 15 分鐘）");
  await expect(panel.getByRole("alert")).toHaveText("建議進入 Incident Mode（L1，延誤）");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(page, "late");

  // 延誤 40 分鐘：L2，且抵達後停留不到原本的一半
  await page.clock.setFixedTime(new Date("2026-12-10T11:10:00+09:00"));
  await page.reload();
  const later = page.getByRole("listitem", { name: "淺草寺" });
  await later.getByText("離開前檢查").click();
  await expect(later.locator("details.departure").getByRole("alert")).toHaveText("建議進入 Incident Mode（L2，延誤）");
  await expect(later.locator("details.departure")).toContainText("不建議前往");
});

test("不是旅行當天時不顯示離開前檢查", async ({ page, context, baseURL }) => {
  const tripId = await setup(page, context, baseURL);
  await page.clock.install({ time: new Date("2026-12-01T10:00:00+09:00") });
  await page.goto(`/trips/${tripId}/today`);
  await expect(page.getByRole("listitem", { name: "淺草寺" })).toBeVisible();
  await expect(page.getByText("離開前檢查")).toHaveCount(0);
});
