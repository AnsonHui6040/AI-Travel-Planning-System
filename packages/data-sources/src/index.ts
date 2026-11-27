import {
  checkDataSourceAdapter,
  createRegistry,
  type DataCapability,
  type DataSourceAdapter,
  type Registry,
} from "@atps/core";

// 第 2.3 節資料源註冊表。新增資料源只需實作 DataSourceAdapter 並註冊（第 7.2 節）
export interface DataSourceRegistry extends Registry<DataSourceAdapter> {
  // 依能力與地區篩選；regions 為 global 的資料源適用所有地區
  withCapability(capability: DataCapability, region?: string): DataSourceAdapter[];
}

export function createDataSourceRegistry(): DataSourceRegistry {
  const registry = createRegistry<DataSourceAdapter>({
    kind: "DataSourceAdapter",
    idOf: (a) => a.id,
    check: checkDataSourceAdapter,
  });
  return {
    ...registry,
    withCapability: (capability, region) =>
      registry
        .list()
        .filter((a) => a.capabilities.includes(capability))
        .filter((a) => region === undefined || a.regions === "global" || a.regions.includes(region)),
  };
}

// T19：Google Maps Platform（Places API (New)、Maps URLs）
export {
  COORDINATE_MAX_AGE_DAYS,
  GoogleMapsError,
  coordinatesDue,
  createGoogleMapsAdapter,
  createGoogleMapsClient,
  createGoogleMapsKeyTester,
  directionsUrl,
  type GoogleMapsClient,
  type LivePlaceCandidate,
  MAX_SEARCH_QUERY,
  type GoogleMapsOptions,
  type LatLng,
  type LivePlaceDetails,
  type PhotoRef,
  type ResolveResult,
} from "./google-maps";

// T22：即時資料（C-03、D13、D30）
export { LiveDataError, MAX_RESPONSE_BYTES, type LiveFetchOptions } from "./live-http";
export { createOpenMeteoAdapter, createOpenMeteoClient, type ForecastRequest, type HourlyWeather, type WeatherForecast } from "./open-meteo";
export {
  JMA_WARNING_CODES,
  createJmaWarningAdapter,
  createJmaWarningClient,
  type JmaAreaWarnings,
  type JmaOptions,
  type JmaWarning,
  type JmaWarningResult,
} from "./jma-warnings";
export { acceptOfficialTransitReport, classifyOdptStatus, createOdptAdapter, createOdptClient, createOdptKeyTester } from "./odpt";
