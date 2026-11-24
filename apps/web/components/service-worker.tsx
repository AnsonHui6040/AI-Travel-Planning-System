"use client";

import { useEffect } from "react";

// T35：註冊 service worker（PWA、離線當日包）

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
