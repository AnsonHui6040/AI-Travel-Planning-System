import type { ReactNode } from "react";
import { uuid } from "@atps/schemas";
import { TripNav } from "../../../components/trip-nav";

// 行程內所有頁面共用的分頁導覽；各頁面仍自行檢查登入與成員資格

export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <>
      {uuid.safeParse(tripId).success ? <TripNav tripId={tripId} /> : null}
      {children}
    </>
  );
}
