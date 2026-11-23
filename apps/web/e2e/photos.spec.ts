import { expect, test, type Page } from "@playwright/test";
import { createItem, createTrip, downloadStoredPhoto, signInAsNewUser } from "./support/auth";

// T21：照片（S-09、D14）。需本機 Supabase 與 apps/web/.env.local

// 由瀏覽器產生可解碼的 JPEG，再插入含 GPS 的 EXIF 區段（APP1）
async function jpegWithGps(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#2f6f4f";
      ctx.fillRect(0, 0, 64, 48);
    }
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";
  });
  const jpeg = Buffer.from(base64, "base64");
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 0, 0, 0, 2, 0x4e, 0, 0, 0, 0, 0,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff, Buffer.from("GPS 35.7148,139.7967", "latin1")]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, payload, jpeg.subarray(2)]);
}

test("沒有照片時顯示當地名稱與地址", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京");
  const itemId = await createItem(tripId, { name_zh: "淺草寺", name_local: "浅草寺", address: "東京都台東区浅草2-3-1" });
  await page.goto(`/trips/${tripId}/items/${itemId}/photos`);
  const fallback = page.getByLabel("沒有照片");
  await expect(fallback).toContainText("浅草寺");
  await expect(fallback).toContainText("東京都台東区浅草2-3-1");
});

test("上傳含 GPS EXIF 的照片後，儲存的檔案沒有 EXIF，頁面顯示照片與拍攝者", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京");
  const itemId = await createItem(tripId, { name_zh: "淺草寺" });
  await page.goto(`/trips/${tripId}/items/${itemId}/photos`);

  const original = await jpegWithGps(page);
  expect(original.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(true);
  await page.getByLabel("照片（JPEG、PNG、WebP，5 MB 以內）").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: original });
  await page.getByLabel("拍攝者（選填）").fill("小明");
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("status")).toContainText("已上傳照片");

  const stored = await downloadStoredPhoto(tripId);
  expect(stored.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
  expect(stored.includes(Buffer.from("Exif", "latin1"))).toBe(false);
  expect(stored.includes(Buffer.from("GPS", "latin1"))).toBe(false);
  expect(stored.includes(Buffer.from("35.7148", "latin1"))).toBe(false);

  await page.reload();
  const image = page.getByRole("list", { name: "照片" }).getByRole("img", { name: "淺草寺" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("照片：小明")).toBeVisible();
});

test("Commons 照片授權不合格時拒絕儲存", async ({ page, context, baseURL }) => {
  const owner = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京");
  const itemId = await createItem(tripId, { name_zh: "淺草寺" });
  await page.goto(`/trips/${tripId}/items/${itemId}/photos`);
  await page.getByLabel("照片（JPEG、PNG、WebP，5 MB 以內）").setInputFiles({ name: "c.jpg", mimeType: "image/jpeg", buffer: await jpegWithGps(page) });
  await page.getByRole("radio", { name: "Wikimedia Commons" }).check();
  await page.getByLabel("作者").fill("Example Author");
  await page.getByLabel("授權（例如 CC BY-SA 4.0）").fill("保留所有權利");
  await page.getByLabel("Commons 檔案頁網址").fill("https://commons.wikimedia.org/wiki/File:Sensoji.jpg");
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("status")).toContainText("授權必須是");
  await page.reload();
  await expect(page.getByLabel("沒有照片")).toBeVisible();
});

test("Viewer 看不到上傳表單，非成員看不到照片", async ({ page, context, baseURL, browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewUser(ownerContext, baseURL ?? "");
  const viewer = await signInAsNewUser(context, baseURL ?? "");
  const tripId = await createTrip(owner.userId, "東京", [{ userId: viewer.userId, role: "viewer" }]);
  const itemId = await createItem(tripId, { name_zh: "淺草寺" });
  await page.goto(`/trips/${tripId}/items/${itemId}/photos`);
  await expect(page.getByLabel("沒有照片")).toBeVisible();
  await expect(page.getByRole("button", { name: "上傳" })).toHaveCount(0);

  const outsider = await browser.newContext();
  await signInAsNewUser(outsider, baseURL ?? "");
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`/trips/${tripId}/items/${itemId}/photos`);
  await expect(outsiderPage.getByText("找不到這個項目")).toBeVisible();
  await ownerContext.close();
  await outsider.close();
});
