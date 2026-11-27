"use client";

import { isPackDay, type DayPack } from "@atps/offline";
import { useEffect, useState } from "react";
import { DeparturePanel } from "./departure-panel";

// 項目詳情的離開前檢查（T37）：只在當天顯示，時間每分鐘更新

export function ItemDeparture({ pack, index }: { pack: DayPack; index: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!now || !isPackDay(pack, now)) return null;
  return <DeparturePanel pack={pack} index={index} now={now} />;
}
