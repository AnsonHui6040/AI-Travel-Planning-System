import { describe, expect, it } from "vitest";
import { approvalRule, classifyVersionKind, planIncident, type IncidentItem, type IncidentPlanInput, type StoredMobilityEstimate } from "./index";

// T38：Incident Mode（第 2.6、2.9 節，D10）

const DAY = "2026-12-03";
const tokyo = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00+09:00`);

let seq = 0;
const item = (over: Partial<IncidentItem> & Pick<IncidentItem, "id" | "name_zh">): IncidentItem => ({
  type: "attraction",
  zone_id: "asakusa",
  scheduled_date: null,
  scheduled_start: null,
  scheduled_end: null,
  hard: false,
  priority: 3,
  weather_dependency: "low",
  suggested_stay_minutes: 60,
  availability: [],
  verification_status: "verified",
  standby: false,
  cost: null,
  order: seq++,
  ...over,
});

const scheduled = (id: string, name: string, start: string, end: string, over: Partial<IncidentItem> = {}, date = DAY) =>
  item({ id, name_zh: name, scheduled_date: date, scheduled_start: start, scheduled_end: end, ...over });

const items: IncidentItem[] = [
  scheduled("d3-temple", "淺草寺", "09:00", "10:30"),
  scheduled("d3-lunch", "淺草午餐", "11:30", "12:30", { type: "restaurant" }),
  scheduled("d3-photo", "隅田川攝影", "13:00", "14:30", { type: "photography", weather_dependency: "high", priority: 4 }),
  scheduled("d3-walk", "合羽橋散步", "15:00", "16:30", { weather_dependency: "medium" }),
  scheduled("d3-shop", "上野室內購物", "17:00", "18:00", { type: "shopping", zone_id: "ueno" }),
  scheduled("d3-dinner", "已付款晚餐", "19:00", "21:00", { type: "restaurant", hard: true, zone_id: "shinjuku", cost: { amount: 15000, currency: "JPY" } }),
  scheduled("d4-shrine", "明治神宮", "10:00", "11:30", { zone_id: "harajuku" }, "2026-12-04"),
  scheduled("d5-ginza", "銀座散步", "10:00", "12:00", { zone_id: "ginza" }, "2026-12-05"),
  item({ id: "c-museum", name_zh: "淺草室內博物館", standby: true, suggested_stay_minutes: 90, cost: { amount: 800, currency: "JPY" } }),
  item({ id: "c-craft", name_zh: "藏前室內工坊", standby: true }),
  item({ id: "c-ueno", name_zh: "上野博物館", zone_id: "ueno", priority: 4, suggested_stay_minutes: 120 }),
  item({ id: "c-ginza", name_zh: "銀座百貨", zone_id: "ginza", type: "shopping" }),
  item({ id: "c-garden", name_zh: "戶外庭園", weather_dependency: "high", priority: 5 }),
  item({ id: "c-unverified", name_zh: "未核實咖啡店", verification_status: "unverified", priority: 5 }),
];

const estimate = (over: Partial<StoredMobilityEstimate>): StoredMobilityEstimate => ({
  mode: "rail",
  door_to_door_minutes: 15,
  price: { amount: 180, currency: "JPY" },
  walk_minutes: 6,
  transfers: 0,
  luggage_friendliness: "medium",
  comfort: "medium",
  delay_risk: "low",
  source_urls: ["https://www.tokyometro.jp/"],
  buffer_minutes: 10,
  total_minutes: 25,
  ...over,
});

const base = (over: Partial<IncidentPlanInput> = {}): IncidentPlanInput => ({
  tripDates: ["2026-12-01", "2026-12-02", DAY, "2026-12-04", "2026-12-05"],
  date: DAY,
  timezone: "Asia/Tokyo",
  now: tokyo("13:00"),
  trigger: { type: "heavy_rain", until: "18:00" },
  items,
  fixedActivities: [],
  location: { lat: 35.714765, lng: 139.796655 },
  companions: "ok",
  luggage: "light",
  weather: "大雨",
  liveTransit: null,
  travel: (from, to) =>
    from === "d3-photo" && to === "c-museum"
      ? [
          estimate({ mode: "walk", door_to_door_minutes: 12, price: null, walk_minutes: 12, total_minutes: 22, comfort: "low", luggage_friendliness: "low" }),
          estimate({ mode: "taxi", door_to_door_minutes: 8, price: { amount: 1200, currency: "JPY" }, walk_minutes: 1, total_minutes: 18, comfort: "high", luggage_friendliness: "high" }),
        ]
      : [],
  transportPreferences: [],
  ...over,
});

const touched = (plan: ReturnType<typeof planIncident>) => plan.alternatives.flatMap((a) => a.change.operations.map((o) => o.itemId));
const byId = new Map(items.map((i) => [i.id, i]));

describe("Current State Snapshot", () => {
  it("包含位置、時間、同行者、行李、天氣、即時交通、已完成活動、下一個固定活動、最遲到達時間", () => {
    const { snapshot } = planIncident(base());
    expect(snapshot).toEqual({
      date: DAY,
      time: "13:00",
      // 位置只保留小數第三位
      location: { lat: 35.715, lng: 139.797 },
      currentItem: "隅田川攝影",
      companions: "ok",
      luggage: "light",
      weather: "大雨",
      liveTransit: null,
      completed: ["淺草寺", "淺草午餐"],
      nextFixed: { name: "已付款晚餐", start: "19:00" },
      latestArrival: "18:45",
    });
  });

  it("基線的固定活動也是 Hard Constraint", () => {
    const { snapshot } = planIncident(base({ fixedActivities: [{ name: "歌舞伎", date: DAY, start: "17:30", end: "19:00" }] }));
    expect(snapshot.nextFixed).toEqual({ name: "歌舞伎", start: "17:30" });
    expect(snapshot.latestArrival).toBe("17:15");
  });
});

describe("E1 後段：13:00 淺草開始大雨", () => {
  const plan = planIncident(base());

  it("分級 L3，只計算至下一個 Hard Constraint（局部重算）", () => {
    expect(plan.level).toBe("L3");
    expect(plan.scope).toMatchObject({ kind: "local", date: DAY, from: "13:00", until: "18:45" });
    expect(plan.scope.itemIds).toEqual(["d3-photo", "d3-walk"]);
  });

  it("提出三個方案，依同區域、鄰近區域、另一日候選的次序", () => {
    expect(plan.alternatives.map((a) => a.tier)).toEqual(["same_zone", "nearby_zone", "other_day"]);
  });

  it("同區域方案優先使用 Standby，並排在步行可達的時間之後", () => {
    const ops = plan.alternatives[0]?.change.operations ?? [];
    expect(ops).toEqual([
      { op: "schedule_item", itemId: "d3-photo", date: null, start: null, end: null },
      { op: "schedule_item", itemId: "c-museum", date: DAY, start: "13:25", end: "14:30" },
      { op: "schedule_item", itemId: "d3-walk", date: null, start: null, end: null },
      { op: "schedule_item", itemId: "c-craft", date: DAY, start: "15:00", end: "16:00" },
    ]);
  });

  it("只修改 Day 3 13:00–17:00；Day 4、Day 5 與已付款活動不變；戶外與未核實候選不使用", () => {
    for (const alt of plan.alternatives) {
      for (const op of alt.change.operations) {
        if (op.op !== "schedule_item") continue;
        const before = byId.get(op.itemId);
        expect(before?.scheduled_date ?? DAY).toBe(DAY);
        if (before?.scheduled_start) expect(before.scheduled_start >= "13:00" && (before.scheduled_end ?? "") <= "17:00").toBe(true);
        if (op.date !== null) expect(op.date === DAY && (op.start ?? "") >= "13:00" && (op.end ?? "") <= "17:00").toBe(true);
      }
    }
    expect(touched(plan)).not.toContain("d3-dinner");
    expect(touched(plan)).not.toContain("d4-shrine");
    expect(touched(plan)).not.toContain("d5-ginza");
    expect(touched(plan)).not.toContain("c-garden");
    expect(touched(plan)).not.toContain("c-unverified");
  });

  it("每個方案需批准，版本類型與第 2.7 節判定一致", () => {
    for (const alt of plan.alternatives) {
      expect(alt.change.changeKind).toBe("incident_L3");
      expect(approvalRule(alt.change.changeKind).apply).toBe("approval");
      expect(alt.change.versionKind).toBe(classifyVersionKind(alt.change.operations, items));
      expect(alt.change.versionKind).toBe("minor");
      expect(alt.impactScope.dates).toEqual([DAY]);
    }
  });

  it("每個方案提供最快、最便宜、最舒適交通", () => {
    expect(plan.alternatives[0]?.transport).toEqual({
      estimated: false,
      recommended: expect.objectContaining({ mode: "walk", minutes: 22 }),
      fastest: expect.objectContaining({ mode: "taxi", minutes: 18 }),
      cheapest: expect.objectContaining({ mode: "walk", minutes: 22 }),
      comfortable: expect.objectContaining({ mode: "taxi" }),
    });
    // 沒有交通估算時以預設時間計算並註明
    expect(plan.alternatives[1]?.transport).toMatchObject({ estimated: true, fastest: { mode: null, minutes: 30 } });
  });

  it("比較表包含全部欄位，且只有一個推薦", () => {
    for (const alt of plan.alternatives) {
      expect(Object.keys(alt.comparison).sort()).toEqual(
        [
          "newActivity",
          "arrival",
          "leaveBy",
          "cost",
          "walkMinutes",
          "transfers",
          "luggageFit",
          "weatherRisk",
          "affectsDinner",
          "affectsTomorrow",
          "experienceLoss",
          "score",
          "recommended",
        ].sort(),
      );
      expect(alt.comparison.affectsDinner).toBe(false);
      expect(alt.comparison.affectsTomorrow).toBe(false);
      expect(alt.comparison.weatherRisk).toBe("low");
    }
    expect(plan.alternatives[0]?.comparison).toMatchObject({
      newActivity: ["淺草室內博物館", "藏前室內工坊"],
      arrival: "13:25",
      cost: { amount: 800, currency: "JPY", complete: false },
      walkMinutes: 12,
      transfers: 0,
      luggageFit: "low",
    });
    expect(plan.alternatives.filter((a) => a.comparison.recommended)).toHaveLength(1);
  });
});

describe("替代方案次序", () => {
  it("可交換今日順序時排在另一日候選之前", () => {
    // 17:00 以後雨停：17:00 的室內購物與 15:00 的散步交換時段
    const plan = planIncident(base({ trigger: { type: "heavy_rain", until: "17:00" }, items: items.filter((i) => i.id !== "c-ueno") }));
    expect(plan.alternatives.map((a) => a.tier)).toEqual(["same_zone", "swap_order", "other_day"]);
    expect(plan.alternatives[1]?.change.operations).toEqual(
      expect.arrayContaining([
        { op: "schedule_item", itemId: "d3-walk", date: DAY, start: "17:00", end: "18:00" },
        { op: "schedule_item", itemId: "d3-shop", date: DAY, start: "15:00", end: "16:30" },
      ]),
    );
  });

  it("沒有合適候選時提出刪減活動", () => {
    const onlyScheduled = items.filter((i) => i.scheduled_date !== null);
    const plan = planIncident(base({ items: onlyScheduled }));
    expect(plan.alternatives.map((a) => a.tier)).toEqual(["drop"]);
    expect(plan.alternatives[0]?.comparison).toMatchObject({ newActivity: [], experienceLoss: "high" });
  });

  it("休館只替換該項目", () => {
    const plan = planIncident(base({ trigger: { type: "attraction_closed", itemId: "d3-walk" }, weather: null }));
    expect(plan.level).toBe("L3");
    expect(plan.scope.itemIds).toEqual(["d3-walk"]);
    expect(touched(plan)).not.toContain("d3-photo");
  });

  it("延誤 15 分鐘、緩衝足夠時為 L1，第一個方案為壓縮緩衝", () => {
    const plan = planIncident(base({ now: tokyo("12:45"), trigger: { type: "delay", minutes: 15 } }));
    expect(plan.level).toBe("L1");
    expect(plan.alternatives[0]?.tier).toBe("compress");
    expect(plan.alternatives[0]?.change.operations).toEqual([
      { op: "schedule_item", itemId: "d3-photo", date: DAY, start: "13:15", end: "14:30" },
    ]);
    expect(plan.alternatives[0]?.change.changeKind).toBe("incident_L1");
  });

  it("延誤使下一個 Hard Constraint 無法準時時為 L3", () => {
    const plan = planIncident(base({ now: tokyo("17:30"), trigger: { type: "delay", minutes: 70 } }));
    expect(plan.level).toBe("L3");
  });
});

describe("E2：15:40 晴空塔提早完成", () => {
  const day = [
    scheduled("e2-tree", "晴空塔", "13:00", "16:30", { zone_id: "oshiage" }),
    scheduled("e2-dinner", "已付款晚餐", "19:00", "21:00", { hard: true, zone_id: "shinjuku" }),
    item({ id: "e2-aquarium", name_zh: "墨田水族館", zone_id: "oshiage", suggested_stay_minutes: 90 }),
    item({ id: "e2-long", name_zh: "整日體驗", zone_id: "oshiage", suggested_stay_minutes: 300 }),
    item({ id: "e2-rejected", name_zh: "淘汰的店", zone_id: "oshiage", verification_status: "conflict" }),
  ];
  const plan = planIncident(base({ now: tokyo("15:40"), trigger: { type: "early_finish" }, items: day, weather: null }));

  it("只從 Candidate List 選擇，放不下的候選不列入", () => {
    expect(plan.level).toBe("none");
    const ids = touched(plan);
    expect(ids).toEqual(["e2-aquarium"]);
  });

  it("顯示最遲離開時間，且需批准（不自動加入行程）", () => {
    const alt = plan.alternatives[0];
    expect(alt?.change.changeKind).toBe("add_candidate_to_gap");
    expect(approvalRule("add_candidate_to_gap").apply).toBe("approval");
    expect(alt?.comparison.leaveBy).toBe("18:15");
    expect(alt?.change.operations).toEqual([{ op: "schedule_item", itemId: "e2-aquarium", date: DAY, start: "16:10", end: "17:40" }]);
  });
});

describe("E6：取消 Day 3 16:00 的咖啡時段", () => {
  const day = [
    scheduled("e6-tree", "晴空塔", "13:00", "15:00"),
    scheduled("e6-cafe", "藏前咖啡時段", "16:00", "17:00", { type: "restaurant" }),
    scheduled("e6-dinner", "已付款晚餐", "19:00", "21:00", { hard: true, zone_id: "shinjuku" }),
    scheduled("e6-d4", "明治神宮", "10:00", "11:30", {}, "2026-12-04"),
    item({ id: "e6-sweets", name_zh: "藏前甜點店", type: "restaurant" }),
  ];
  const plan = planIncident(base({ now: tokyo("15:10"), trigger: { type: "slot_cancelled", itemId: "e6-cafe" }, items: day, weather: null }));

  it("只調整同一時段，其他日期無變更", () => {
    expect(plan.scope.itemIds).toEqual(["e6-cafe"]);
    for (const alt of plan.alternatives) {
      expect(alt.change.changeKind).toBe("minor_non_incident");
      for (const op of alt.change.operations) {
        expect(["e6-cafe", "e6-sweets"]).toContain(op.itemId);
        if (op.op === "schedule_item" && op.date !== null) expect(op.date === DAY && (op.start ?? "") >= "16:00" && (op.end ?? "") <= "17:00").toBe(true);
      }
    }
    expect(plan.alternatives.map((a) => a.tier)).toEqual(["same_zone", "drop"]);
  });
});

describe("E8：航班改一天", () => {
  const plan = planIncident(base({ trigger: { type: "flight_shift", newFirstDate: "2026-12-01", newLastDate: "2026-12-04" }, weather: null }));

  it("分類為 Major（L4），整趟重算", () => {
    expect(plan.level).toBe("L4");
    expect(plan.scope.kind).toBe("whole_trip");
    expect(plan.alternatives).toHaveLength(1);
    const change = plan.alternatives[0]?.change;
    expect(change?.changeKind).toBe("major_version");
    expect(change?.versionKind).toBe("major");
    expect(change?.structural).toEqual(["flight_date"]);
    expect(change?.operations).toEqual([{ op: "schedule_item", itemId: "d5-ginza", date: null, start: null, end: null }]);
    expect(approvalRule("major_version").apply).toBe("approval");
    expect(plan.alternatives[0]?.impactScope.dates).toEqual(["2026-12-01", "2026-12-02", DAY, "2026-12-04", "2026-12-05"]);
    expect(plan.alternatives[0]?.comparison.affectsTomorrow).toBe(true);
  });

  it("取消日期上的 Hard Constraint 另外提醒", () => {
    const withPaid = [...items, scheduled("d5-paid", "已付款茶道", "14:00", "15:00", { hard: true }, "2026-12-05")];
    const p = planIncident(base({ items: withPaid, trigger: { type: "flight_shift", newFirstDate: "2026-12-01", newLastDate: "2026-12-04" } }));
    expect(p.warnings).toEqual(["已付款茶道（2026-12-05）是 Hard Constraint，需另行處理預約或退款"]);
  });
});

describe("時間邊界", () => {
  it("在當天開始之前進入時，以 00:00 計算", () => {
    const plan = planIncident(base({ now: new Date("2026-11-26T10:00:00+09:00") }));
    expect(plan.snapshot.time).toBe("00:00");
    expect(plan.snapshot.completed).toEqual([]);
    expect(plan.scope.itemIds).toEqual(["d3-photo", "d3-walk"]);
  });
});

describe("輸入檢查", () => {
  it("觸發項目不在當天行程時拋出錯誤", () => {
    expect(() => planIncident(base({ trigger: { type: "attraction_closed", itemId: "d4-shrine" } }))).toThrow();
  });
});
