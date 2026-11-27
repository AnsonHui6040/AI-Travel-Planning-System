import "server-only";
import { createGoogleMapsClient } from "@atps/data-sources";
import { SupabaseKeyDecryptor } from "@atps/db";
import { FETCH_API_HOSTS, allowlistedFetchAsFetch, createAllowlistedFetch, createLogger } from "@atps/security";
import { searchPlacesFor, type PlaceSearch } from "./places-core";
import { createSupabaseServiceClient } from "./supabase";

// 決策 0010 S：Places 文字搜尋經白名單 fetch（S-05：只連 fetch-allowlist.json 的 apiHosts），以使用者本人的 key（C-05）。
// E2E 以 E2E_PLACES_FIXTURE=1 改用合成回應（不連 Google）；Vercel 上一律關閉

const FIXTURE = JSON.stringify({
  places: [
    { id: "ChIJe2e-synthetic-place-0001", displayName: { text: "一蘭 道頓堀店（合成）" }, formattedAddress: "大阪市中央區道頓堀 1-4-16（合成）" },
    { id: "ChIJe2e-synthetic-place-0002", displayName: { text: "一蘭 難波店（合成）" }, formattedAddress: null },
  ],
});

function placesFetch() {
  if (process.env.E2E_PLACES_FIXTURE === "1" && process.env.VERCEL !== "1") {
    return async () => new Response(FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
  }
  return allowlistedFetchAsFetch(createAllowlistedFetch({ allowlist: FETCH_API_HOSTS }));
}

export async function searchPlaces(userId: string, query: string | undefined): Promise<PlaceSearch> {
  const keys = new SupabaseKeyDecryptor(createSupabaseServiceClient());
  const client = createGoogleMapsClient({ fetch: placesFetch() });
  return searchPlacesFor(
    {
      mapsKey: () => keys.forOwner(userId, "google_maps"),
      search: (key, q) => client.searchPlaces(key, { query: q, languageCode: "zh-TW" }),
      logError: (message) => createLogger().error(message),
    },
    query,
  );
}
