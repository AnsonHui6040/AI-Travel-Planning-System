import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { GuardOptions } from "./guard";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}`);
  return value;
}

// C-09：一般資料存取以請求者本人的 session（anon key）進行，受 RLS 限制
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        },
      },
    },
  );
}

// C-09：service role 只用於 API key 的儲存與解密（T12），呼叫的資料庫函式只授權 service_role。
// 不保存 session、不讀寫 cookie；只在伺服器模組使用（server-only）
export function createSupabaseServiceClient() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function allowedOrigins(): string[] {
  return [new URL(requireEnv("SITE_URL")).origin];
}

// 以請求者本人的 session 讀取使用者並呼叫資料庫的速率限制
export async function supabaseGuardDeps(): Promise<Pick<GuardOptions, "getUser" | "checkRateLimit" | "allowedOrigins">> {
  const supabase = await createSupabaseServerClient();
  return {
    allowedOrigins: allowedOrigins(),
    getUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    checkRateLimit: async (endpoint, limit, windowSeconds) => {
      const { data, error } = await supabase.rpc("check_rate_limit", {
        p_endpoint: endpoint,
        p_max: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error("速率限制檢查失敗");
      return data === true;
    },
  };
}
