// T04：容器健康檢查。不需登入、不連外部服務、不回傳任何設定值
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
