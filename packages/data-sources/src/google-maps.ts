import type { DataSourceAdapter, KeyTester } from "@atps/core";

// T19：Google Maps Platform adapter（Places API (New)、Maps URLs）。只在伺服器使用。
// D28、Places API 政策：place_id 可永久保存；座標最多保存 30 日；名稱、地址、評分、照片只即時顯示，不儲存。
// S-16：place_id 由伺服器以 Places 搜尋解析，並比對名稱與位置。
// key 只放在請求標頭（照片 media 端點依文件放在伺服器端的查詢參數），不出現在回傳值、錯誤訊息或導航連結。

const BASE = "https://places.googleapis.com/v1";
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{1,500}$/;
const SEARCH_RADIUS_METERS = 5_000;
export const COORDINATE_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GoogleMapsOptions {
  // 伺服器端以 @atps/security 的 allowlistedFetchAsFetch 經白名單連線（決策 0010、S-05）
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  now?: () => Date;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type ResolveResult = { status: "resolved"; placeId: string } | { status: "unresolved"; reason: "not_found" | "name_mismatch" | "too_far" };

export interface PhotoRef {
  name: string;
  attributions: { displayName: string; uri: string | null }[];
}

// 決策 0010：搜尋結果。名稱與地址只即時顯示，保存時只取 place_id（D28）
export interface LivePlaceCandidate {
  storable: false;
  placeId: string;
  name: string;
  address: string | null;
}
export const MAX_SEARCH_QUERY = 100;
const SEARCH_RESULTS = 5;

// 只即時顯示，不可儲存
export interface LivePlaceDetails {
  storable: false;
  placeId: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  googleMapsUri: string | null;
  photos: PhotoRef[];
}

export class GoogleMapsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function errorFor(status: number): GoogleMapsError {
  if (status === 403) return new GoogleMapsError("Google Maps 拒絕請求（403）", status);
  if (status === 429) return new GoogleMapsError("Google Maps 請求過於頻繁（429）", status);
  if (status >= 500) return new GoogleMapsError(`Google Maps 暫時無法使用（${status}）`, status);
  return new GoogleMapsError(`Google Maps 請求失敗（${status}）`, status);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function latLng(v: unknown): LatLng | null {
  if (!isObject(v)) return null;
  const lat = num(v.latitude);
  const lng = num(v.longitude);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function httpsOrNull(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

// 名稱比對：NFKC、忽略大小寫、空白與標點
function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function createGoogleMapsClient(options: GoogleMapsOptions = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => new Date());

  async function request(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch {
      throw new GoogleMapsError("無法連線 Google Maps", null);
    }
    if (!response.ok) throw errorFor(response.status);
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GoogleMapsError("Google Maps 回應格式不正確", response.status);
    }
  }

  const headers = (key: string, fieldMask: string) => ({
    "content-type": "application/json",
    "x-goog-api-key": key,
    "x-goog-fieldmask": fieldMask,
  });

  async function searchText(key: string, fieldMask: string, body: Record<string, unknown>): Promise<unknown[]> {
    const data = await request(`${BASE}/places:searchText`, { method: "POST", headers: headers(key, fieldMask), body: JSON.stringify(body) });
    return isObject(data) && Array.isArray(data.places) ? data.places : [];
  }

  function assertPlaceId(placeId: string) {
    if (!PLACE_ID.test(placeId)) throw new GoogleMapsError("place_id 格式不正確", null);
  }

  return {
    async resolvePlaceId(
      key: string,
      input: { name: string; area?: string; near?: LatLng; languageCode: string },
    ): Promise<ResolveResult> {
      const body: Record<string, unknown> = {
        textQuery: [input.name, input.area].filter(Boolean).join(" "),
        languageCode: input.languageCode,
        pageSize: 5,
      };
      if (input.near) {
        body.locationBias = { circle: { center: { latitude: input.near.lat, longitude: input.near.lng }, radius: SEARCH_RADIUS_METERS } };
      }
      const places = await searchText(key, "places.id,places.displayName,places.location", body);
      if (places.length === 0) return { status: "unresolved", reason: "not_found" };
      const named = places.filter(
        (p) => isObject(p) && isObject(p.displayName) && typeof p.displayName.text === "string" && namesMatch(p.displayName.text, input.name),
      ) as Record<string, unknown>[];
      if (named.length === 0) return { status: "unresolved", reason: "name_mismatch" };
      const near = input.near;
      const match = near
        ? named.find((p) => {
            const at = latLng(p.location);
            return at !== null && distanceMeters(at, near) <= SEARCH_RADIUS_METERS;
          })
        : named[0];
      if (!match) return { status: "unresolved", reason: "too_far" };
      const placeId = str(match.id);
      return placeId && PLACE_ID.test(placeId) ? { status: "resolved", placeId } : { status: "unresolved", reason: "not_found" };
    },

    async searchPlaces(key: string, input: { query: string; languageCode: string }): Promise<LivePlaceCandidate[]> {
      const query = input.query.trim();
      if (query.length === 0 || query.length > MAX_SEARCH_QUERY) throw new GoogleMapsError("搜尋字須為 1 到 100 字", null);
      const places = await searchText(key, "places.id,places.displayName,places.formattedAddress", {
        textQuery: query,
        languageCode: input.languageCode,
        pageSize: SEARCH_RESULTS,
      });
      return places.flatMap((p) => {
        if (!isObject(p)) return [];
        const placeId = str(p.id);
        const name = isObject(p.displayName) ? str(p.displayName.text) : null;
        if (!placeId || !PLACE_ID.test(placeId) || !name) return [];
        return [{ storable: false as const, placeId, name, address: str(p.formattedAddress) }];
      }).slice(0, SEARCH_RESULTS);
    },

    async coordinates(key: string, placeId: string): Promise<LatLng & { fetchedAt: Date }> {
      assertPlaceId(placeId);
      const data = await request(`${BASE}/places/${placeId}`, { method: "GET", headers: headers(key, "location") });
      const at = isObject(data) ? latLng(data.location) : null;
      if (!at) throw new GoogleMapsError("Google Maps 回應沒有座標", null);
      return { ...at, fetchedAt: now() };
    },

    async liveDetails(key: string, placeId: string, languageCode: string): Promise<LivePlaceDetails> {
      assertPlaceId(placeId);
      const url = `${BASE}/places/${placeId}?languageCode=${encodeURIComponent(languageCode)}`;
      const data = await request(url, { method: "GET", headers: headers(key, "id,displayName,formattedAddress,rating,googleMapsUri,photos") });
      const d = isObject(data) ? data : {};
      const photos: PhotoRef[] = (Array.isArray(d.photos) ? d.photos : []).flatMap((p) => {
        if (!isObject(p)) return [];
        const name = str(p.name);
        if (!name || !PHOTO_NAME.test(name)) return [];
        const attributions = (Array.isArray(p.authorAttributions) ? p.authorAttributions : []).flatMap((a) =>
          isObject(a) && str(a.displayName) ? [{ displayName: str(a.displayName) as string, uri: httpsOrNull(a.uri) }] : [],
        );
        return [{ name, attributions }];
      });
      return {
        storable: false,
        placeId,
        name: isObject(d.displayName) ? str(d.displayName.text) : null,
        address: str(d.formattedAddress),
        rating: num(d.rating),
        googleMapsUri: httpsOrNull(d.googleMapsUri),
        photos,
      };
    },

    // 照片名稱會過期，不可快取；每次由詳情取得後立即換成圖片網址
    async photoUri(key: string, photoName: string, maxWidthPx: number): Promise<{ photoUri: string }> {
      if (!PHOTO_NAME.test(photoName)) throw new GoogleMapsError("照片名稱格式不正確", null);
      const width = Math.min(4800, Math.max(1, Math.round(maxWidthPx)));
      const url = `${BASE}/${photoName}/media?maxWidthPx=${width}&skipHttpRedirect=true&key=${encodeURIComponent(key)}`;
      const data = await request(url, { method: "GET" });
      const photoUri = isObject(data) ? httpsOrNull(data.photoUri) : null;
      if (!photoUri) throw new GoogleMapsError("Google Maps 回應沒有照片網址", null);
      return { photoUri };
    },

    async testKey(key: string): Promise<void> {
      // Text Search Essentials ID Only：最小、最低費用的呼叫
      await searchText(key, "places.id", { textQuery: "Tokyo Station", pageSize: 1 });
    },
  };
}

export type GoogleMapsClient = ReturnType<typeof createGoogleMapsClient>;

// 取得超過 30 日或尚未取得座標、且有 place_id 的項目
export function coordinatesDue<T extends { place_id: string | null; coord_fetched_at: string | null }>(items: readonly T[], now: Date): T[] {
  return items.filter((item) => {
    if (item.place_id === null) return false;
    if (item.coord_fetched_at === null) return true;
    return now.getTime() - new Date(item.coord_fetched_at).getTime() >= COORDINATE_MAX_AGE_DAYS * DAY_MS;
  });
}

export function createGoogleMapsKeyTester(options: GoogleMapsOptions = {}): KeyTester {
  const client = createGoogleMapsClient(options);
  return {
    provider: "google_maps",
    async test(secret) {
      try {
        await client.testKey(secret);
        return { ok: true };
      } catch (error) {
        const status = error instanceof GoogleMapsError ? error.status : null;
        if (status === 400 || status === 401 || status === 403) return { ok: false, reason: "Google Maps key 無效，或尚未啟用 Places API (New)" };
        if (status === 429) return { ok: false, reason: "Google Maps 請求過於頻繁，請稍後再試" };
        return { ok: false, reason: "無法連線 Google Maps，請稍後再試" };
      }
    },
  };
}

// DataSourceAdapter（第 2.3 節）：place 能力。每次請求以使用者本人的 key 建立（C-05）
export function createGoogleMapsAdapter(options: GoogleMapsOptions & { apiKey: string }): DataSourceAdapter {
  const client = createGoogleMapsClient(options);
  const now = options.now ?? (() => new Date());
  return {
    id: "google-maps",
    capabilities: ["place"],
    regions: "global",
    // 官方 API 端點，不經白名單 fetch
    fetchHosts: [],
    async query(request) {
      if (request.capability !== "place" || request.params.op !== "coordinates" || typeof request.params.placeId !== "string") {
        throw new GoogleMapsError("不支援的查詢", null);
      }
      const { lat, lng } = await client.coordinates(options.apiKey, request.params.placeId);
      return { capability: "place", data: { lat, lng }, retrievedAt: now(), source: { name: "Google Maps", url: "https://maps.google.com/" } };
    },
  };
}

// D26：導航以 Google Maps URLs 開啟；不需要也不含 key
export function directionsUrl(input: {
  // T28：指定出發地時開啟對應路段；沒有時由使用者目前位置出發
  origin?: string;
  originPlaceId?: string | null;
  destination: string;
  destinationPlaceId: string | null;
  travelmode?: "transit" | "walking" | "driving" | "bicycling";
}): string {
  const params = new URLSearchParams({ api: "1" });
  if (input.origin) {
    params.set("origin", input.origin);
    if (input.originPlaceId && PLACE_ID.test(input.originPlaceId)) params.set("origin_place_id", input.originPlaceId);
  }
  params.set("destination", input.destination);
  if (input.destinationPlaceId && PLACE_ID.test(input.destinationPlaceId)) params.set("destination_place_id", input.destinationPlaceId);
  params.set("travelmode", input.travelmode ?? "transit");
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
