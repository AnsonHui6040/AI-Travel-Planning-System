import type { LivePlaceCandidate } from "@atps/data-sources";

// 決策 0010 S：新增地點畫面的搜尋。key 由伺服器自 Vault 取得（C-02），不出現在畫面或錯誤訊息。
// D28：結果只即時顯示，保存時只取 place_id

export type PlaceSearch =
  | { state: "no_key" }
  | { state: "idle" }
  | { state: "ok"; query: string; results: LivePlaceCandidate[] }
  | { state: "error"; query: string; message: string };

export interface PlaceSearchDeps {
  mapsKey: () => Promise<string | null>;
  search: (key: string, query: string) => Promise<LivePlaceCandidate[]>;
  logError: (message: string) => void;
}

export async function searchPlacesFor(deps: PlaceSearchDeps, rawQuery: string | undefined): Promise<PlaceSearch> {
  const key = await deps.mapsKey();
  if (!key) return { state: "no_key" };
  const query = (rawQuery ?? "").trim();
  if (query.length === 0) return { state: "idle" };
  if (query.length > 100) return { state: "error", query: query.slice(0, 100), message: "搜尋字最多 100 字" };
  try {
    return { state: "ok", query, results: await deps.search(key, query) };
  } catch {
    deps.logError("搜尋地點失敗");
    return { state: "error", query, message: "暫時無法搜尋，請稍後再試，或直接手動新增" };
  }
}
