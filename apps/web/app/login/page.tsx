import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "../../lib/server/redirect";
import { createSupabaseServerClient } from "../../lib/server/supabase";
import { LoginForm } from "../entry-forms";
import "../home.css";

// 登入（D05）：Email magic link。本機開發的信件在 Supabase 的測試信箱（http://localhost:54324）

export const metadata: Metadata = { title: "登入" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; auth_error?: string }> }) {
  const { next, auth_error } = await searchParams;
  const target = safeRedirectPath(next ?? null, "http://localhost");
  const session = await createSupabaseServerClient();
  const { data } = await session.auth.getUser();
  if (data.user) redirect(target);
  return (
    <main className="home">
      <h1>登入</h1>
      {auth_error ? <p className="error">登入連結無效或已過期，請重新寄送。</p> : null}
      <LoginForm next={target} />
    </main>
  );
}
