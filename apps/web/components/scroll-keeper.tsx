"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

// 清單的捲動區（docs/verification/ux-logic-2026-11-27.md 第 4 節：標題與按鈕固定，只有清單捲動）。
// 從詳情返回時（畫面上的返回或瀏覽器的上一頁）恢復捲動位置；位置存在 sessionStorage，鍵含篩選條件

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ScrollKeeper({ scrollKey, className, children }: { scrollKey: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const storageKey = `scroll:${scrollKey}`;

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    // 手機的詳情畫面也會渲染（隱藏的）清單：隱藏時不讀也不寫位置
    if (!el || el.clientHeight === 0) return;
    const saved = Number(sessionStorage.getItem(storageKey) ?? "0");
    if (saved > 0) el.scrollTop = saved;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.clientHeight > 0) sessionStorage.setItem(storageKey, String(Math.round(el.scrollTop)));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [storageKey]);

  return (
    <div ref={ref} className={className ? `scroll-area ${className}` : "scroll-area"} data-scroll-key={scrollKey}>
      {children}
    </div>
  );
}
