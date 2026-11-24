"use client";

import type { DayPack } from "@atps/offline";
import { useEffect, useState } from "react";
import { TodayBody } from "../../components/today-body";
import { loadPack } from "../../lib/client/offline-store";

// 由網址取得行程編號，從 IndexedDB 讀取最近一次儲存的當日包

export function OfflineToday() {
  const [state, setState] = useState<{ pack: DayPack | null; loaded: boolean }>({ pack: null, loaded: false });
  useEffect(() => {
    const match = /^\/trips\/([0-9a-f-]{36})\/today/.exec(window.location.pathname);
    if (!match?.[1]) {
      setState({ pack: null, loaded: true });
      return;
    }
    void loadPack(match[1])
      .then((pack) => setState({ pack, loaded: true }))
      .catch(() => setState({ pack: null, loaded: true }));
  }, []);
  if (!state.loaded) return <p className="muted">正在讀取離線當日包</p>;
  if (!state.pack) return <p>這台裝置沒有這個行程的離線當日包。請在有網路時開啟一次當日行程。</p>;
  return (
    <>
      <p className="trip-line">{state.pack.date}</p>
      <TodayBody pack={state.pack} canEdit offline />
    </>
  );
}
