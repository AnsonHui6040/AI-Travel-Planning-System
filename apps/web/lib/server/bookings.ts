import "server-only";
import type { BookingConstraint, BookingKind } from "@atps/core";
import { tripBaselineData, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { BookingStoreError, type BookingDeps, type ChecklistKind } from "./bookings-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 決策 0010 B：預訂與清單以使用者本人的 session 讀寫（RLS：成員可讀，Owner、Companion 可寫，非成員看不到）。
// 不使用 service role。計算用的 loadBookingConstraints 不讀取預約碼；預約碼只在預訂畫面與離線包（成員裝置）顯示。

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function storeError(code: string | undefined): BookingStoreError {
  if (code === "42501") return new BookingStoreError("forbidden");
  if (code === "22023" || code === "23514" || code === "22P02" || code === "23503") return new BookingStoreError("invalid");
  if (code === "54000") return new BookingStoreError("limit");
  return new BookingStoreError("unknown");
}

export async function bookingActionDeps(): Promise<BookingDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const me = async () => (await guard.getUser())?.id ?? "";
  const affected = (result: { data: unknown[] | null; error: { code?: string } | null }) => {
    if (result.error) throw storeError(result.error.code);
    return result.data?.length ?? 0;
  };
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async saveBooking(tripId, bookingId, data) {
      if (bookingId) {
        const { data: rows, error } = await session.from("bookings").update(data).eq("trip_id", tripId).eq("id", bookingId).select("id");
        if (error) throw storeError(error.code);
        if (rows.length === 0) throw new BookingStoreError("forbidden");
        return bookingId;
      }
      const { data: row, error } = await session.from("bookings").insert({ ...data, trip_id: tripId, created_by: await me() }).select("id").single();
      if (error || !row) throw storeError(error?.code);
      return String(row.id);
    },
    deleteBooking: async (tripId, id) => affected(await session.from("bookings").delete().eq("trip_id", tripId).eq("id", id).select("id")),
    async createList(tripId, kind, title) {
      const { data, error } = await session.from("checklists").insert({ trip_id: tripId, kind, title, created_by: await me() }).select("id").single();
      if (error || !data) throw storeError(error?.code);
      return String(data.id);
    },
    deleteList: async (tripId, id) => affected(await session.from("checklists").delete().eq("trip_id", tripId).eq("id", id).select("id")),
    async addListItem(tripId, listId, text, assignee) {
      const { data, error } = await session
        .from("checklist_items")
        .insert({ trip_id: tripId, list_id: listId, text, assignee, created_by: await me() })
        .select("id")
        .single();
      if (error || !data) throw storeError(error?.code);
      return String(data.id);
    },
    updateListItem: async (tripId, id, fields) => affected(await session.from("checklist_items").update(fields).eq("trip_id", tripId).eq("id", id).select("id")),
    deleteListItem: async (tripId, id) => affected(await session.from("checklist_items").delete().eq("trip_id", tripId).eq("id", id).select("id")),
    logError: (message) => createLogger().error(message),
  };
}

// 計算用（固定活動、Morning Check、Incident Mode、可行性）：不讀取預約碼與備註
export async function loadBookingConstraints(session: Session, tripId: string): Promise<BookingConstraint[]> {
  const { data } = await session
    .from("bookings")
    .select("id, kind, title, starts_at, ends_at, timezone, location, item_id")
    .eq("trip_id", tripId)
    .order("starts_at")
    .limit(300);
  return (data ?? []).map((b) => ({
    id: String(b.id),
    kind: b.kind as BookingKind,
    title: String(b.title),
    starts_at: String(b.starts_at),
    ends_at: b.ends_at ? String(b.ends_at) : null,
    timezone: String(b.timezone),
    location: b.location ? String(b.location) : null,
    item_id: b.item_id ? String(b.item_id) : null,
  }));
}

export interface BookingRecord extends BookingConstraint {
  confirmationCode: string | null;
  note: string | null;
  itemName: string | null;
}

// 旅行基線內的航班與住宿：唯讀列出（沒有預約碼）；已有相同時間的預訂時不重複列出
export interface BaselineBooking {
  key: string;
  kind: "flight" | "lodging";
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export interface Member {
  userId: string;
  name: string;
}

export type BookingsView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripId: string;
      tripName: string;
      timezone: string;
      canEdit: boolean;
      bookings: BookingRecord[];
      baseline: BaselineBooking[];
      items: Array<{ id: string; name: string }>;
    };

async function tripAccess(session: Session, tripId: string) {
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" as const };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" as const };
  const { data: trip } = await session.from("trips").select("name, timezone").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" as const };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
  return {
    state: "ok" as const,
    tripName: String(trip.name),
    timezone: String(trip.timezone),
    canEdit: member?.role === "owner" || member?.role === "companion",
  };
}

export async function loadBookings(tripId: string): Promise<BookingsView> {
  const session = await createSupabaseServerClient();
  const access = await tripAccess(session, tripId);
  if (access.state !== "ok") return access;
  const [bookingsRes, itemsRes, baselineRes] = await Promise.all([
    session
      .from("bookings")
      .select("id, kind, title, starts_at, ends_at, timezone, location, confirmation_code, note, item_id")
      .eq("trip_id", tripId)
      .order("starts_at")
      .limit(300),
    session.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId).order("name_zh").limit(500),
    session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle(),
  ]);
  if (bookingsRes.error) throw new Error("讀取預訂失敗");
  const items = (itemsRes.data ?? []).map((i) => ({ id: String(i.id), name: String(i.name_zh) }));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const bookings: BookingRecord[] = (bookingsRes.data ?? []).map((b) => ({
    id: String(b.id),
    kind: b.kind as BookingKind,
    title: String(b.title),
    starts_at: String(b.starts_at),
    ends_at: b.ends_at ? String(b.ends_at) : null,
    timezone: String(b.timezone),
    location: b.location ? String(b.location) : null,
    item_id: b.item_id ? String(b.item_id) : null,
    confirmationCode: b.confirmation_code ? String(b.confirmation_code) : null,
    note: b.note ? String(b.note) : null,
    itemName: b.item_id ? (itemName.get(String(b.item_id)) ?? null) : null,
  }));
  const parsed = baselineRes.data ? tripBaselineData.safeParse(baselineRes.data.data) : null;
  const baseline: BaselineBooking[] = [];
  if (parsed?.success) {
    parsed.data.flights.forEach((f, k) => {
      if (bookings.some((b) => b.kind === "flight" && Date.parse(b.starts_at) === Date.parse(f.departs_at))) return;
      baseline.push({ key: `flight-${k}`, kind: "flight", title: f.label, startsAt: f.departs_at, endsAt: f.arrives_at });
    });
    parsed.data.lodgings.forEach((l, k) => {
      const tz = parsed.data.timezone;
      if (bookings.some((b) => b.kind === "lodging" && localDate(b.starts_at, tz) === l.check_in)) return;
      baseline.push({ key: `lodging-${k}`, kind: "lodging", title: l.name, startsAt: `${l.check_in}T${l.check_in_time ?? "15:00"}`, endsAt: l.check_out });
    });
  }
  return { state: "ok", tripId, tripName: access.tripName, timezone: access.timezone, canEdit: access.canEdit, bookings, baseline, items };
}

const localDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export interface ChecklistRecord {
  id: string;
  kind: ChecklistKind;
  title: string;
  items: Array<{ id: string; text: string; assignee: string | null; checked: boolean }>;
}

export type ChecklistsView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripId: string;
      tripName: string;
      canEdit: boolean;
      lists: ChecklistRecord[];
      members: Member[];
    };

// 清單與項目（未完成在前、依建立順序）；離線包也使用
export async function readChecklists(session: Session, tripId: string): Promise<ChecklistRecord[]> {
  const [listsRes, itemsRes] = await Promise.all([
    session.from("checklists").select("id, kind, title").eq("trip_id", tripId).order("created_at").limit(30),
    session.from("checklist_items").select("id, list_id, text, assignee, checked").eq("trip_id", tripId).order("created_at").limit(9000),
  ]);
  if (listsRes.error || itemsRes.error) throw new Error("讀取清單失敗");
  return (listsRes.data ?? []).map((l) => ({
    id: String(l.id),
    kind: l.kind as ChecklistKind,
    title: String(l.title),
    items: (itemsRes.data ?? [])
      .filter((i) => i.list_id === l.id)
      .map((i) => ({ id: String(i.id), text: String(i.text), assignee: i.assignee ? String(i.assignee) : null, checked: i.checked === true })),
  }));
}

export async function tripMembers(session: Session, tripId: string): Promise<Member[]> {
  const { data: rows } = await session.from("trip_members").select("user_id, joined_at").eq("trip_id", tripId).order("joined_at").limit(100);
  const ids = (rows ?? []).map((m) => String(m.user_id));
  if (ids.length === 0) return [];
  const { data: profiles } = await session.from("profiles").select("id, display_name").in("id", ids);
  return ids.map((userId) => {
    const p = (profiles ?? []).find((x) => x.id === userId);
    return { userId, name: p?.display_name ? String(p.display_name) : "未設定名稱的成員" };
  });
}

export async function loadChecklists(tripId: string): Promise<ChecklistsView> {
  const session = await createSupabaseServerClient();
  const access = await tripAccess(session, tripId);
  if (access.state !== "ok") return access;
  const [lists, members] = await Promise.all([readChecklists(session, tripId), tripMembers(session, tripId)]);
  return { state: "ok", tripId, tripName: access.tripName, canEdit: access.canEdit, lists, members };
}
