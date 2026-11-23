import type { DataSourceAdapter } from "@atps/core";
import { LiveDataError, createJsonGetter, isObject, num, str, type LiveFetchOptions } from "./live-http";

// T22、D13：Open-Meteo 天氣預報（不需 key）。座標四捨五入到小數第二位（約 1 公里）再送出，
// 避免送出精確位置；只保存在記憶體中，由呼叫端決定是否存入離線包。

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const HOURLY = ["temperature_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m"] as const;
const MAX_DAYS = 16;
const SOURCE = { name: "Open-Meteo", url: "https://open-meteo.com/" } as const;

export interface HourlyWeather {
  // 預報地點的當地時間（ISO 8601，不含時差）
  time: string;
  temperatureC: number | null;
  precipitationProbability: number | null;
  precipitationMm: number | null;
  // WMO 天氣代碼
  weatherCode: number | null;
  windSpeedKmh: number | null;
}

export interface WeatherForecast {
  timeZone: string;
  hours: HourlyWeather[];
  retrievedAt: Date;
  source: { name: string; url: string };
}

export interface ForecastRequest {
  lat: number;
  lng: number;
  timeZone: string;
  days: number;
}

function isTimeZone(value: string): boolean {
  if (!value.includes("/") && value !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function parseForecast(data: unknown, now: Date): WeatherForecast {
  if (!isObject(data) || !isObject(data.hourly)) throw new LiveDataError("Open-Meteo 回應格式不正確", null);
  const hourly = data.hourly;
  const times = hourly.time;
  if (!Array.isArray(times) || times.some((t) => typeof t !== "string")) throw new LiveDataError("Open-Meteo 回應格式不正確", null);
  const series = HOURLY.map((key) => hourly[key]);
  if (series.some((s) => !Array.isArray(s) || s.length !== times.length)) throw new LiveDataError("Open-Meteo 回應格式不正確", null);
  const at = (i: number, k: number): number | null => num((series[k] as unknown[])[i]);
  return {
    timeZone: str(data.timezone) ?? "UTC",
    hours: (times as string[]).map((time, i) => ({
      time,
      temperatureC: at(i, 0),
      precipitationProbability: at(i, 1),
      precipitationMm: at(i, 2),
      weatherCode: at(i, 3),
      windSpeedKmh: at(i, 4),
    })),
    retrievedAt: now,
    source: { ...SOURCE },
  };
}

export function createOpenMeteoClient(options: LiveFetchOptions = {}) {
  const get = createJsonGetter("Open-Meteo", options);
  const now = options.now ?? (() => new Date());
  return {
    async forecast(request: ForecastRequest): Promise<WeatherForecast> {
      const { lat, lng, timeZone, days } = request;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new LiveDataError("座標超出範圍", null);
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new LiveDataError(`預報天數須為 1–${MAX_DAYS}`, null);
      if (!isTimeZone(timeZone)) throw new LiveDataError("時區須為 IANA 名稱", null);
      const url = new URL(ENDPOINT);
      url.searchParams.set("latitude", String(round2(lat)));
      url.searchParams.set("longitude", String(round2(lng)));
      url.searchParams.set("hourly", HOURLY.join(","));
      url.searchParams.set("timezone", timeZone);
      url.searchParams.set("forecast_days", String(days));
      return parseForecast(await get(url), now());
    },
  };
}

// DataSourceAdapter（第 2.3 節）：weather 能力
export function createOpenMeteoAdapter(options: LiveFetchOptions = {}): DataSourceAdapter {
  const client = createOpenMeteoClient(options);
  return {
    id: "open-meteo",
    capabilities: ["weather"],
    regions: "global",
    // 固定的官方 API 端點，不經白名單 fetch
    fetchHosts: [],
    async query(request) {
      const p = request.params;
      if (request.capability !== "weather" || typeof p.lat !== "number" || typeof p.lng !== "number" || typeof p.timeZone !== "string" || typeof p.days !== "number") {
        throw new LiveDataError("不支援的查詢", null);
      }
      const forecast = await client.forecast({ lat: p.lat, lng: p.lng, timeZone: p.timeZone, days: p.days });
      return { capability: "weather", data: forecast, retrievedAt: forecast.retrievedAt, source: forecast.source };
    },
  };
}
