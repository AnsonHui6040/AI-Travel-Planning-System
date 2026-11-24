"use client";

import type { DayPack } from "@atps/offline";
import { useEffect, useState } from "react";
import { savePack } from "../../../../lib/client/offline-store";

// T35：線上開啟時把當日包存入 IndexedDB，預先快取照片與離線頁面

export function SavePack({ pack }: { pack: DayPack }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await savePack(pack);
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.ready;
        await Promise.all([fetch("/offline-today"), ...pack.photos.map((p) => fetch(p.url))]).catch(() => undefined);
      }
      if (!cancelled) setSaved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [pack]);
  return (
    <p className="muted" data-offline-ready={saved ? "yes" : "no"}>
      {saved ? "已儲存離線當日包，沒有網路時也能開啟這一頁" : "正在儲存離線當日包"}
    </p>
  );
}
