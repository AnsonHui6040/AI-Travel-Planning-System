import type { Metadata } from "next";
import Link from "next/link";
import { uuid } from "@atps/schemas";
import { createSupabaseServerClient } from "../../../../lib/server/supabase";
import { TripSettingsForm } from "./settings-form";
import "./settings.css";

// 決策 0011：行程設定（名稱、目的地、日期）。只限 Owner；由「更多」與行程分頁標題進入

export const metadata: Metadata = { title: "行程設定" };
export const dynamic = "force-dynamic";

export default async function TripSettingsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  const trip =
    auth.user && uuid.safeParse(tripId).success
      ? (await session.from("trips").select("name, destination, status").eq("id", tripId).maybeSingle()).data
      : null;
  const member = trip && auth.user ? (await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle()).data : null;
  if (!trip || member?.role !== "owner" || trip.status === "ended" || trip.status === "archived") {
    return (
      <main className="screen trip-settings">
        <h1>行程設定</h1>
        <p>{!auth.user ? "請先登入。" : trip && member ? (member.role === "owner" ? "行程已結束，不能再修改。" : "只有 Owner 可以修改行程設定。") : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const { data: baseline } = await session.from("trip_baselines").select("data, confirmed_at").eq("trip_id", tripId).eq("version", 1).maybeSingle();
  const data = baseline?.confirmed_at ? (baseline.data as { start_date?: string; end_date?: string }) : null;
  return (
    <main className="screen trip-settings">
      <header className="screen-head">
        <Link className="back-link" href={`/trips/${tripId}/more`} aria-label="返回更多">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          更多
        </Link>
        <h1>行程設定</h1>
      </header>
      <TripSettingsForm
        tripId={tripId}
        name={String(trip.name)}
        destination={String(trip.destination ?? "")}
        start={data?.start_date ?? null}
        end={data?.end_date ?? null}
      />
    </main>
  );
}
