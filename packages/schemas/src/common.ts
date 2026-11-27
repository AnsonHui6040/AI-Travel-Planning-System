import { z } from "zod";

// 決策 0002：AI 填寫欄位的驗證格式與上下限。資料庫 check constraint 使用相同數值。

export const LIMITS = {
  nameZh: 80,
  nameLocal: 120,
  address: 200,
  area: 80,
  longText: 300,
  shortNote: 200,
  // 決策 0010：成員自行輸入的項目備註
  itemNote: 500,
  stayMinutes: { min: 5, max: 600 },
  priority: { min: 1, max: 5 },
  score: { min: 0, max: 5 },
  urlLength: 2048,
  money: { min: 0, max: 10_000_000 },
  doorToDoorMinutes: { min: 1, max: 1440 },
  walkMinutes: { min: 0, max: 600 },
  transfers: { min: 0, max: 10 },
  bufferMinutes: { min: 0, max: 240 },
  modelName: 100,
} as const;

export const uuid = z.uuid();

export const isoDate = z.iso.date();

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間格式須為 HH:mm");

export const offsetDateTime = z.iso.datetime({ offset: true });

export const ianaTimezone = z.string().refine((value) => {
  if (!value.includes("/") && value !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "時區須為 IANA 名稱");

export const httpsUrl = z
  .string()
  .max(LIMITS.urlLength)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "網址只限 https");

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "幣別須為 ISO 4217 三個大寫字母");

export const moneyAmount = z.number().min(LIMITS.money.min).max(LIMITS.money.max);

export const money = z.strictObject({ amount: moneyAmount, currency: currencyCode });

export const score = z.int().min(LIMITS.score.min).max(LIMITS.score.max);

export const text = (max: number) => z.string().min(1).max(max);
