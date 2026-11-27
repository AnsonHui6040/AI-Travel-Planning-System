import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/server/supabase";
import { CreateTripForm } from "../../entry-forms";
import "../../home.css";

// 新行程：另開畫面（docs/verification/ux-logic-2026-11-27.md 第 5 節）。建立後到旅行基線

export const metadata: Metadata = { title: "新行程" };
export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const session = await createSupabaseServerClient();
  const { data } = await session.auth.getUser();
  if (!data.user) redirect("/login?next=/trips/new");
  return (
    <main className="home new-trip">
      <Link className="back-link" href="/" aria-label="返回所有行程">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        所有行程
      </Link>
      <h1>新行程</h1>
      <p className="muted">建立後先填寫 Trip Baseline（日期、航班、住宿、固定活動）。</p>
      <CreateTripForm />
    </main>
  );
}
