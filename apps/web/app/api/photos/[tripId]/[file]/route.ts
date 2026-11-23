import { guardRequest } from "../../../../../lib/server/guard";
import { downloadPhoto } from "../../../../../lib/server/photos";
import { supabaseGuardDeps } from "../../../../../lib/server/supabase";

// T21：同源提供行程照片。登入、Origin 與速率限制；成員資格由 Storage 的 RLS 判斷，非成員回應 404
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string; file: string }> }) {
  const guard = await guardRequest(request, { endpoint: "photos.read", limit: 300, windowSeconds: 60, ...(await supabaseGuardDeps()) });
  if (!guard.ok) return guard.response;
  const { tripId, file } = await params;
  const photo = await downloadPhoto(`${tripId}/${file}`);
  if (!photo) return Response.json({ error: "找不到照片" }, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(photo.bytes, {
    headers: {
      "content-type": photo.contentType,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
