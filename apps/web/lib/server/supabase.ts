import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { GuardOptions } from "./guard";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}`);
  return value;
}

// C-09：伺服器端只用 anon key，資料存取受 RLS 限制；service role key 不在此使用
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
