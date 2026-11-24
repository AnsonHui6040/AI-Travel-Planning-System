import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "./supabase";

// T33：唯讀連結的讀取（C-10、SH-08）。只呼叫 readonly_trip（擁有者 atps_readonly_reader，只有讀取權限），
// 不使用 service role，不呼叫 AI、Google Maps 或其他外部 API（readonly-boundary.test.ts 檢查）。

const readonlyTrip = z.object({
  trip: z.object({
    name: z.string(),
    destination: z.string().nullable(),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    timezone: z.string(),
    status: z.string(),
  }),
  days: z.array(z.object({ date: z.string(), status: z.string() })),
  items: z.array(
    z.object({
      id: z.string(),
      name_zh: z.string(),
      name_local: z.string().nullable(),
      address: z.string().nullable(),
      scheduled_date: z.string(),
      scheduled_start: z.string().nullable(),
      scheduled_end: z.string().nullable(),
      verification_status: z.string(),
      at_risk: z.boolean(),
    }),
  ),
  sensitive: z.array(z.object({ name: z.string(), field: z.enum(["full_name", "phone", "email"]), value: z.string() })),
});
export type ReadonlyTrip = z.infer<typeof readonlyTrip>;

export async function loadReadonlyTrip(token: string): Promise<ReadonlyTrip | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("readonly_trip", { p_token: token });
  if (error || !data) return null;
  const parsed = readonlyTrip.safeParse(data);
  return parsed.success ? parsed.data : null;
}
