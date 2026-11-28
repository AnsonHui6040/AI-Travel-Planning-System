"use server";

import { importSpec } from "@atps/ai";
import { previewImport, type ImportPreviewResult } from "../../../../lib/server/import-core";
import { importPreviewDeps } from "../../../../lib/server/import";

// 決策 0010 I：行程匯入。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 import-core 內檢查（C-11）。
// 預覽只回傳給本人（不保存）；確認的寫入在 confirm-actions.ts

export async function previewImportText(input: { tripId: string; text: string }): Promise<ImportPreviewResult> {
  return previewImport(await importPreviewDeps(), importSpec(), input);
}
