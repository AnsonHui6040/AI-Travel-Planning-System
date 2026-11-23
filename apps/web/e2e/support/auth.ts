import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// E2E 登入：以本機 Supabase 建立測試使用者，用 @supabase/ssr 登入後把 session cookie 放入瀏覽器
// 需要 supabase start 與 apps/web/.env.local（含本機的 SUPABASE_SERVICE_ROLE_KEY）

function loadEnv(): Record<string, string> {
  const file = readFileSync(path.resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of file.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) env[match[1]] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

function requireValue(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`apps/web/.env.local 缺少 ${name}`);
  return value;
}

export async function signInAsNewUser(context: BrowserContext, baseURL: string): Promise<{ email: string }> {
  const env = loadEnv();
  const url = requireValue(env, "NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireValue(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = requireValue(env, "SUPABASE_SERVICE_ROLE_KEY");

  const email = `e2e-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error("建立測試使用者失敗");

  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => jar,
      setAll: (items) => {
        for (const { name, value } of items) {
          const index = jar.findIndex((c) => c.name === name);
          if (index >= 0) jar.splice(index, 1);
          if (value) jar.push({ name, value });
        }
      },
    },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("測試使用者登入失敗");

  const { hostname } = new URL(baseURL);
  await context.addCookies(jar.map((c) => ({ ...c, domain: hostname, path: "/", httpOnly: false, sameSite: "Lax" })));
  return { email };
}
