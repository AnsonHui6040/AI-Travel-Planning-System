import type { ReactNode } from "react";
import { uuid } from "@atps/schemas";
import { TripNav } from "../../../components/trip-nav";
import { pendingProposalCount } from "../../../lib/server/trip-nav";

// 行程內所有頁面共用的四個分頁（現在、行程、提案、更多）；各頁面仍自行檢查登入與成員資格

export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  if (!uuid.safeParse(tripId).success) return children;
  const pending = await pendingProposalCount(tripId);
  return (
    <div className="trip-shell">
      {children}
      <TripNav tripId={tripId} pending={pending} />
    </div>
  );
}
