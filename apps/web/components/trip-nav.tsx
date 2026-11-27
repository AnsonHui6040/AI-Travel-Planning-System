"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// 行程內固定四個分頁（docs/verification/ux-logic-2026-11-27.md 第 5 節；Apple HIG Tab bars：分頁固定、不因狀態改變）。
// 手機在底部、1024px 以上為左側欄（shell.css）。其他頁面都歸在「更多」之下

type TabKey = "now" | "plan" | "proposals" | "more";

const ICONS: Record<TabKey, ReactNode> = {
  now: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  plan: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  proposals: (
    <>
      <path d="M4 13l3-8h10l3 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
};

const TABS: ReadonlyArray<{ key: TabKey; path: string; label: string; sections: readonly string[] }> = [
  { key: "now", path: "today", label: "現在", sections: ["today", "incident"] },
  { key: "plan", path: "days", label: "行程", sections: ["days", "items"] },
  { key: "proposals", path: "proposals", label: "提案", sections: ["proposals"] },
  { key: "more", path: "more", label: "更多", sections: [] },
];

// /trips/<id>/<區段>：沒有對應分頁的區段（基線、候選、成員…）都屬於「更多」
export function currentTab(pathname: string): TabKey {
  const section = pathname.split("/")[3] ?? "today";
  return TABS.find((t) => t.sections.includes(section))?.key ?? "more";
}

export function TripNav({ tripId, pending }: { tripId: string; pending: number }) {
  const active = currentTab(usePathname());
  return (
    <nav aria-label="行程" className="tabbar">
      {TABS.map((tab) => (
        <Link key={tab.key} href={`/trips/${tripId}/${tab.path}`} aria-current={active === tab.key ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {ICONS[tab.key]}
          </svg>
          <span className="tab-label">
            {tab.label}
            {tab.key === "proposals" && pending > 0 ? (
              <>
                <span className="badge">{pending}</span>
                <span className="sr-only">個待批准</span>
              </>
            ) : null}
          </span>
        </Link>
      ))}
    </nav>
  );
}
