import { redirect } from "next/navigation";

// 行程的入口是「現在」分頁
export default async function TripIndex({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/today`);
}
