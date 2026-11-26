"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 介面方向 A：行程內的膠囊分頁（審查問題 U-4：原本沒有導覽）

const TABS = [
  { path: "today", label: "今天" },
  { path: "days", label: "每日" },
  { path: "candidates", label: "候選" },
  { path: "proposals", label: "提案" },
  { path: "memories", label: "記憶" },
  { path: "post-trip", label: "旅後" },
] as const;

export function TripNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="行程" className="trip-nav">
      {TABS.map((tab) => {
        const href = `/trips/${tripId}/${tab.path}`;
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={tab.path} href={href} aria-current={current ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
