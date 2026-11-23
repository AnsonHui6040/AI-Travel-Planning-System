import { enums } from "@atps/schemas";
import { createRegistry, type Registry } from "./registry";

// T12：BYOK API key（C-02–C-05、C-12）。key 以 Vault 加密儲存，畫面只顯示末四碼。
// 儲存前執行供應商的測試呼叫掛鉤（C-03），由 T13（三家 AI）、T19（Google Maps）、T22（ODPT）各自實作。

export const API_KEY_PROVIDERS = enums.keyProvider.options;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

// 可列印的 ASCII、不含空白，8–512 字元。資料庫函式 save_api_key 以相同條件檢查
const KEY_FORMAT = /^[\x21-\x7e]{8,512}$/;

export function isValidApiKeyFormat(value: string): boolean {
  return KEY_FORMAT.test(value);
}

export function maskApiKey(last4: string): string {
  return `••••${last4}`;
}

export type KeyTestResult = { ok: true } | { ok: false; reason: string };

export interface KeyTester {
  provider: ApiKeyProvider;
  // 以最小呼叫確認 key 可用。不可把 key 寫入 log 或回傳的原因
  test(secret: string): Promise<KeyTestResult>;
}

export function checkKeyTester(tester: KeyTester): string[] {
  const issues: string[] = [];
  if (!(API_KEY_PROVIDERS as readonly string[]).includes(tester.provider)) issues.push("不認識的供應商");
  if (typeof tester.test !== "function") issues.push("缺少 test");
  return issues;
}

export function createKeyTesterRegistry(): Registry<KeyTester> {
  return createRegistry<KeyTester>({ kind: "KeyTester", idOf: (t) => t.provider, check: checkKeyTester });
}

export interface ApiKeyStore {
  // 只由伺服器呼叫；ownerId 必須取自已驗證的 session（C-05）
  save(input: { ownerId: string; provider: ApiKeyProvider; secret: string; testedAt: Date | null }): Promise<void>;
}

export interface KeyDecryptor {
  // 伺服器請求：只能傳入請求者本人的編號
  forOwner(ownerId: string, provider: ApiKeyProvider): Promise<string | null>;
  // 背景 job：資料庫依 job 的發起人取 key（C-12）
  forJob(jobId: string, provider: ApiKeyProvider): Promise<string | null>;
}

export type SaveApiKeyResult = { ok: true; last4: string; tested: boolean } | { ok: false; reason: string };

const FORMAT_ERROR = "API key 格式不正確";
const TEST_ERROR = "測試呼叫失敗，請稍後再試";

export async function saveApiKey(
  deps: { store: ApiKeyStore; testers: readonly KeyTester[]; clock: { now(): Date } },
  input: { ownerId: string; provider: ApiKeyProvider; secret: string },
): Promise<SaveApiKeyResult> {
  const secret = input.secret.trim();
  if (!isValidApiKeyFormat(secret)) return { ok: false, reason: FORMAT_ERROR };

  const tester = deps.testers.find((t) => t.provider === input.provider);
  let testedAt: Date | null = null;
  if (tester) {
    let result: KeyTestResult;
    try {
      result = await tester.test(secret);
    } catch {
      return { ok: false, reason: TEST_ERROR };
    }
    if (!result.ok) return { ok: false, reason: result.reason.includes(secret) ? TEST_ERROR : result.reason };
    testedAt = deps.clock.now();
  }

  await deps.store.save({ ownerId: input.ownerId, provider: input.provider, secret, testedAt });
  return { ok: true, last4: secret.slice(-4), tested: testedAt !== null };
}
