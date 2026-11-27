import { NowTrip } from "../../../../components/now-trip";
import { loadToday } from "../../../../lib/server/today";
import { SavePack } from "./save-pack";

// 旅行中的「現在」：當日包由伺服器組成（RLS），下一站與倒數在瀏覽器端計算

const DAY_STATUS: Record<string, string> = { approved: "已批准", day_ready: "Day Ready", in_progress: "進行中", completed: "已完成" };

export async function NowTripScreen({ tripId, date }: { tripId: string; date: string | undefined }) {
  const view = await loadToday(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="screen now">
        <h1>現在</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  if (!view.pack) {
    return (
      <main className="screen now">
        <header className="screen-head">
          <h1>{view.tripName}</h1>
        </header>
        <p className="muted">還沒有已批准的每日行程。</p>
      </main>
    );
  }
  const pack = view.pack;
  const counts = { ok: 0, attention: 0, no_data: 0 };
  for (const c of view.morning?.checks ?? []) if (c.status in counts) counts[c.status as keyof typeof counts] += 1;
  const summary = view.morning
    ? [counts.ok ? `${counts.ok} 正常` : "", counts.attention ? `${counts.attention} 留意` : "", counts.no_data ? `${counts.no_data} 無資料` : ""].filter(Boolean).join(" ")
    : "尚未執行";
  const dayNumber = view.dates.indexOf(pack.date) + 1;
  const dayLabel = [`${pack.date.slice(5).replace("-", "/")} 第 ${dayNumber} 天`, DAY_STATUS[view.dayStatus ?? ""] ?? "尚未批准"].join("，");
  return (
    <NowTrip
      pack={pack}
      tripName={view.tripName}
      dayLabel={dayLabel}
      morning={{ text: `Morning Check ${summary}`, href: `/trips/${tripId}/today/check?date=${pack.date}` }}
      canEdit={view.canEdit}
      directions={view.directions}
      modeToNext={view.modeToNext}
      initialNow={new Date().toISOString()}
      saver={<SavePack pack={pack} />}
    />
  );
}
