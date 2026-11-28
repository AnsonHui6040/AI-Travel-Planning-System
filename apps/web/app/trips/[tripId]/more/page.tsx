import type { Metadata } from "next";
import Link from "next/link";
import { expenseLedgerEnabled } from "../../../../lib/server/expenses";
import { loadTripHeader } from "../../../../lib/server/trip-nav";
import { ReverifyToggle } from "../../../inbox-forms";
import "./more.css";

// 「更多」分頁：四個分頁以外的頁面都在這裡，由分頁兩次點擊內可到（docs/verification/ux-logic-2026-11-27.md 第 5 節）

export const metadata: Metadata = { title: "更多" };
export const dynamic = "force-dynamic";

export default async function MorePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadTripHeader(tripId);
  if (view.state !== "ok") {
    return (
      <main className="screen more">
        <h1>更多</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const base = `/trips/${tripId}`;
  const ledger = await expenseLedgerEnabled();
  const groups: Array<{ title: string; links: Array<{ href: string; label: string; note: string }> }> = [
    {
      title: "行程資料",
      links: [
        ...(view.role === "owner" ? [{ href: `${base}/settings`, label: "行程設定", note: "名稱、目的地、日期" }] : []),
        { href: `${base}/baseline`, label: "旅行基線", note: "日期、航班、住宿、固定活動" },
        { href: `${base}/candidates`, label: "候選", note: "研究結果與核實" },
        { href: `${base}/bookings`, label: "預訂", note: "航班、住宿、餐廳、票券與預約碼" },
        { href: `${base}/lists`, label: "清單", note: "打包與待辦，離線可看" },
        { href: `${base}/import`, label: "匯入", note: "貼上確認信或其他 App 的行程" },
        { href: `${base}/today/check`, label: "Morning Check", note: "今天的十項檢查" },
        { href: `${base}/timeline`, label: "Actual Timeline", note: "記錄實際到達與離開" },
        { href: `${base}/incident`, label: "Incident 紀錄", note: "出狀況時的替代方案" },
        { href: `${base}/post-trip`, label: "旅後回顧", note: "旅後狀態與比較報告" },
        ...(ledger ? [{ href: `${base}/expenses`, label: "記帳", note: "花費、預算與分帳結算" }] : []),
      ],
    },
    {
      title: "成員",
      links: [
        { href: `${base}/members`, label: "成員", note: "邀請、角色、唯讀連結" },
        { href: `${base}/my-info`, label: "我的聯絡資料", note: "只用於這趟旅行" },
      ],
    },
    {
      title: "記憶與設定",
      links: [
        { href: `${base}/memories`, label: "行程記憶", note: "所有成員合併後的限制與偏好" },
        { href: "/settings/memories", label: "我的記憶", note: "個人偏好與旅後記憶提案" },
        { href: "/settings/ai", label: "AI 設定", note: "各角色使用的模型" },
        { href: "/settings/api-keys", label: "API key", note: "Claude、Gemini、Google Maps" },
        { href: "/", label: "所有行程", note: "回到行程清單" },
      ],
    },
  ];
  const canReverify = view.role === "owner" && (view.tripStatus === "planning" || view.tripStatus === "locked");
  return (
    <main className="screen wide more">
      <header className="screen-head">
        <h1>更多</h1>
        <p>{view.tripName}</p>
      </header>
      <div className="screen-body more-groups">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2>{g.title}</h2>
            <ul className="rows">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>
                    <span className="row-name">{l.label}</span>
                    <span className="row-meta">{l.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {canReverify ? (
          <section aria-label="旅前自動再核實" className="more-reverify">
            <h2>旅前自動再核實：{view.reverifyEnabled ? "已開啟" : "未開啟"}</h2>
            <ReverifyToggle tripId={tripId} enabled={view.reverifyEnabled} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
