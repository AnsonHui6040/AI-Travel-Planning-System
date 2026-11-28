import { formParts, timezoneOptions } from "../../../../lib/booking-format";
import { BookingForm, type BookingFormInitial } from "./booking-forms";
import { BackLink, READ_ONLY, type OkBookings } from "./parts";

// 新增與修改預訂共用的畫面（一個畫面一件事：表單與儲存，不用捲動）

export function BookingFormScreen({ view, bookingId }: { view: OkBookings; bookingId: string | null }) {
  const base = `/trips/${view.tripId}/bookings`;
  const existing = bookingId ? view.bookings.find((b) => b.id === bookingId) : undefined;
  const title = bookingId ? "修改預訂" : "新增預訂";
  const back = existing ? `${base}/${existing.id}` : base;
  if (bookingId && !existing) {
    return (
      <main className="screen bookings">
        <BackLink href={base} label="預訂" />
        <h1>{title}</h1>
        <p>找不到這筆預訂。</p>
      </main>
    );
  }
  const tz = existing?.timezone ?? view.timezone;
  const start = formParts(existing?.starts_at ?? null, tz);
  const end = formParts(existing?.ends_at ?? null, tz);
  const initial: BookingFormInitial = {
    kind: existing?.kind ?? "restaurant",
    title: existing?.title ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone: tz,
    location: existing?.location ?? "",
    confirmationCode: existing?.confirmationCode ?? "",
    note: existing?.note ?? "",
    itemId: existing?.item_id ?? "",
  };
  return (
    <main className="screen bookings">
      <header className="screen-head">
        <BackLink href={back} label={existing ? "預訂詳情" : "預訂"} />
        <h1>{title}</h1>
      </header>
      {view.canEdit ? (
        <BookingForm
          tripId={view.tripId}
          bookingId={existing?.id ?? null}
          initial={initial}
          items={view.items}
          timezones={timezoneOptions(view.timezone, existing?.timezone ?? null)}
          cancelHref={back}
        />
      ) : (
        <p>{READ_ONLY}</p>
      )}
    </main>
  );
}
