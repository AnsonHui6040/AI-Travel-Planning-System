"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// T34（SH-06）：以 Supabase Realtime 接收本人的新通知（RLS：只推給收件人），收到後重新整理畫面。
// 瀏覽器只用 anon key 與本人的 session（C-09）

export function LiveNotifications({ userId, tripId }: { userId: string; tripId: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const client = createBrowserClient(url, key);
    let channel: ReturnType<typeof client.channel> | null = null;
    let cancelled = false;
    // 先以本人的 session 設定 Realtime 授權，RLS 才會推送本人的通知
    void client.auth.getSession().then(async ({ data }) => {
      if (cancelled || !data.session) return;
      await client.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = client
        .channel(`notifications:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, (payload) => {
          const row = payload.new as { trip_id?: string | null };
          if (row.trip_id !== tripId) return;
          setNotice("其他成員剛處理了提案，畫面已更新。");
          router.refresh();
        })
        .subscribe((status) => setReady(status === "SUBSCRIBED"));
    });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [userId, tripId, router]);
  return (
    <div data-realtime={ready ? "subscribed" : "connecting"}>
      {notice ? (
        <p role="status" className="live-notice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
