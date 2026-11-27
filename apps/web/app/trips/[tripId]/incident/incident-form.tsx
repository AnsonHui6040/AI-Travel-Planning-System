"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { startIncident } from "./actions";

// T38：出狀況（Incident Mode）第 1 步。先選發生什麼事，再填細節，送出後產生替代方案（第 2 步）。
// 欄位都不受控（React 19 在 Server Action 後會重設表單）；依事件種類顯示的欄位以 CSS 切換。
// 目前位置以瀏覽器定位取得（R4），只在送出時使用，伺服器保存到小數第三位

const TRIGGERS = [
  ["delay", "延誤"],
  ["attraction_closed", "景點休館"],
  ["heavy_rain", "大雨"],
  ["early_finish", "提早完成"],
  ["long_queue", "排隊過長"],
  ["rail_disruption", "鐵路中斷"],
  ["extreme_weather", "極端天氣"],
  ["slot_cancelled", "取消時段"],
  ["flight_shift", "航班改期"],
] as const;

export function IncidentForm({
  tripId,
  date,
  items,
  backHref,
}: {
  tripId: string;
  date: string;
  items: Array<{ id: string; name: string; start: string; end: string }>;
  backHref: string;
}) {
  const [state, action, pending] = useActionState(startIncident, null);
  const lat = useRef<HTMLInputElement>(null);
  const lng = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useState<string>("尚未取得");
  const [step, setStep] = useState<"what" | "details">("what");
  const [chosen, setChosen] = useState(false);

  // 送出失敗時表單已被重設：回到第一步重新選擇
  useEffect(() => {
    if (state && !state.ok) {
      setStep("what");
      setChosen(false);
    }
  }, [state]);

  function locate() {
    if (!("geolocation" in navigator)) {
      setLocation("這個瀏覽器不支援定位");
      return;
    }
    setLocation("取得中…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (lat.current) lat.current.value = String(pos.coords.latitude);
        if (lng.current) lng.current.value = String(pos.coords.longitude);
        setLocation(`${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`);
      },
      () => setLocation("沒有取得位置（未允許定位或無訊號）"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <form action={action} className="screen-form incident-form" onChange={() => setChosen(true)}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="lat" ref={lat} />
      <input type="hidden" name="lng" ref={lng} />
      <div className="screen-body">
        <fieldset className="choices incident-what" hidden={step !== "what"}>
          <legend>發生什麼事？</legend>
          {TRIGGERS.map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="trigger" value={value} required />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="incident-details" hidden={step !== "details"}>
          <label className="f-item">
            受影響的項目
            <select name="itemId" defaultValue="">
              <option value="">請選擇</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.start}–{i.end} {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f-delay">
            延誤分鐘數
            <input name="minutes" type="number" min={1} max={600} inputMode="numeric" />
          </label>
          <label className="f-rain">
            預計雨停（可留空）
            <input name="rainUntil" type="time" />
          </label>
          <label className="f-flight">
            新的第一天
            <input name="newFirstDate" type="date" />
          </label>
          <label className="f-flight">
            新的最後一天
            <input name="newLastDate" type="date" />
          </label>
          <label>
            同行者
            <select name="companions" defaultValue="ok">
              <option value="ok">狀況正常</option>
              <option value="tired">疲累</option>
              <option value="injured">受傷或體力受限</option>
            </select>
          </label>
          <label>
            行李
            <select name="luggage" defaultValue="light">
              <option value="none">沒有行李</option>
              <option value="light">隨身行李</option>
              <option value="heavy">大型行李</option>
            </select>
          </label>
          <p className="incident-location">
            <button className="secondary" type="button" onClick={locate}>
              取得目前位置
            </button>
            <span>目前位置：{location}</span>
          </p>
        </div>
        {state && !state.ok ? (
          <p role="status" className="error">
            {state.message}
          </p>
        ) : null}
      </div>
      {/* 兩步的按鈕各自有 key：React 不可重用同一個 button（點「下一步」時若改成 submit 會直接送出） */}
      {step === "what" ? (
        <div key="what" className="screen-actions">
          <Link className="ghost" href={backHref}>
            取消
          </Link>
          <button className="primary" type="button" disabled={!chosen} onClick={() => setStep("details")}>
            下一步
          </button>
        </div>
      ) : (
        <div key="details" className="screen-actions">
          <button className="ghost" type="button" onClick={() => setStep("what")}>
            上一步
          </button>
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "計算中…" : "產生替代方案"}
          </button>
        </div>
      )}
    </form>
  );
}
