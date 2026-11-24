import { NextResponse } from "next/server";
import { createLogger } from "@atps/security";
import { authorizeCron, runReverifyCron } from "../../../../lib/server/reverify-core";
import { reverifyCronDeps } from "../../../../lib/server/reverify";

// T31：旅前自動再核實的排程端點（Vercel Cron 每天呼叫一次，見 apps/web/vercel.json）。
// 只接受帶有 CRON_SECRET 的請求；回應只含建立的 job 數量

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const started = await runReverifyCron(reverifyCronDeps(), new Date());
    return NextResponse.json({ started: started.length });
  } catch {
    createLogger().error("旅前再核實排程失敗");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
