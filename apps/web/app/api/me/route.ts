import { guardRequest } from "../../../lib/server/guard";
import { supabaseGuardDeps } from "../../../lib/server/supabase";

// 回傳目前登入者編號；未登入 401、Origin 不符 403、超過速率限制 429
export async function GET(request: Request) {
  const guard = await guardRequest(request, {
    endpoint: "me.read",
    limit: 60,
    windowSeconds: 60,
    ...(await supabaseGuardDeps()),
  });
  if (!guard.ok) return guard.response;
  return Response.json({ id: guard.user.id });
}
