import type { Metadata } from "next";
import { OfflineToday } from "./offline-today";
import "../settings/settings.css";
import "../today.css";

// T35：離線時 service worker 以這一頁回應 /trips/<行程>/today，內容從 IndexedDB 讀取

export const metadata: Metadata = { title: "當日行程（離線）", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function OfflineTodayPage() {
  return (
    <main className="settings today">
      <h1>當日行程</h1>
      <OfflineToday />
    </main>
  );
}
