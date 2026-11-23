import {
  API_KEY_PROVIDERS,
  saveApiKey,
  type ApiKeyProvider,
  type ApiKeyStore,
  type KeyDecryptor,
  type KeyTester,
} from "@atps/core";

// T12：API key 設定頁的 Server Action 邏輯。擁有者一律取自已驗證的 session（C-05），
// 表單傳入的任何擁有者欄位都不使用；回應訊息不含 key（C-04）。

export interface ApiKeyActionDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  store: ApiKeyStore;
  decryptor: Pick<KeyDecryptor, "forOwner">;
  // 以請求者本人的 session 刪除，受 RLS 限制
  removeOwn: (provider: ApiKeyProvider) => Promise<void>;
  testers: readonly KeyTester[];
  clock: { now(): Date };
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const RATE = { endpoint: "api_keys.write", limit: 10, windowSeconds: 60 } as const;

function parseProvider(value: FormDataEntryValue | null): ApiKeyProvider | null {
  return typeof value === "string" && (API_KEY_PROVIDERS as readonly string[]).includes(value)
    ? (value as ApiKeyProvider)
    : null;
}

async function authorize(deps: ApiKeyActionDeps): Promise<{ id: string } | ActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) {
    return { ok: false, message: "操作過於頻繁，請稍後再試" };
  }
  return user;
}

export async function saveKeyAction(deps: ApiKeyActionDeps, form: FormData): Promise<ActionResult> {
  const user = await authorize(deps);
  if ("ok" in user) return user;
  const provider = parseProvider(form.get("provider"));
  if (!provider) return { ok: false, message: "不支援的服務" };
  const secret = form.get("secret");
  if (typeof secret !== "string") return { ok: false, message: "API key 格式不正確" };

  try {
    const result = await saveApiKey(
      { store: deps.store, testers: deps.testers, clock: deps.clock },
      { ownerId: user.id, provider, secret },
    );
    if (!result.ok) return { ok: false, message: result.reason };
    return { ok: true, message: `已儲存，末四碼 ${result.last4}${result.tested ? "" : "（尚未測試）"}` };
  } catch {
    return { ok: false, message: "儲存失敗，請稍後再試" };
  }
}

export async function deleteKeyAction(deps: ApiKeyActionDeps, form: FormData): Promise<ActionResult> {
  const user = await authorize(deps);
  if ("ok" in user) return user;
  const provider = parseProvider(form.get("provider"));
  if (!provider) return { ok: false, message: "不支援的服務" };
  try {
    await deps.removeOwn(provider);
    return { ok: true, message: "已刪除" };
  } catch {
    return { ok: false, message: "刪除失敗，請稍後再試" };
  }
}

export async function apiKeyFormAction(deps: ApiKeyActionDeps, form: FormData): Promise<ActionResult> {
  return form.get("intent") === "delete" ? deleteKeyAction(deps, form) : saveKeyAction(deps, form);
}

// 伺服器請求使用 key 時呼叫：只解密請求者本人的 key，沒有其他擁有者的參數（C-02、C-05）
export async function decryptOwnKey(deps: ApiKeyActionDeps, provider: ApiKeyProvider): Promise<string | null> {
  const user = await deps.getUser();
  if (!user) return null;
  return deps.decryptor.forOwner(user.id, provider);
}
