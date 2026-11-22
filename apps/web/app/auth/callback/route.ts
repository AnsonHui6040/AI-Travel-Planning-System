import { NextResponse } from "next/server";
import { safeRedirectPath } from "../../../lib/server/redirect";
import { createSupabaseServerClient } from "../../../lib/server/supabase";

// D05：Google 與 Email magic link 登入後的回呼，以 code 交換 session
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // 只允許站內路徑，避免開放式重新導向
  const destination = safeRedirectPath(url.searchParams.get("next"), url.origin);

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, url.origin));
  }
  return NextResponse.redirect(new URL("/?auth_error=1", url.origin));
}
