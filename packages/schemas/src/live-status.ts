import { z } from "zod";
import { httpsUrl, offsetDateTime } from "./common";

// T22、D30：Verification 讀取官方運行情報頁後回報的結構。只接受此 schema，額外欄位拒絕
export const transitCondition = z.enum(["normal", "delayed", "suspended", "other_abnormal"]);

export const officialTransitReport = z.strictObject({
  routeId: z.string().trim().min(1).max(200),
  condition: transitCondition,
  text: z.string().trim().max(500).nullable(),
  sourceUrl: httpsUrl,
  checkedAt: offsetDateTime,
});
export type OfficialTransitReport = z.infer<typeof officialTransitReport>;
