// S-10、C-04：遮罩 API key
export { redactSecrets } from "./redact";

// T16、S-05：白名單 fetch（只供伺服器端使用）
export { isPublicAddress } from "./address";
export {
  DEFAULT_FETCH_LIMITS,
  FETCH_ALLOWLIST,
  createAllowlistedFetch,
  type AllowlistedFetchOptions,
  type FetchBlockReason,
  type FetchLimits,
  type FetchResult,
  type FetchTransport,
  type ResolveHost,
  type TransportResponse,
} from "./allowlisted-fetch";
export { nodeResolve, nodeTransport, pinnedLookup } from "./node-transport";

// T17、S-07、S-10：AI payload allowlist builder 與 log 遮罩
export {
  AI_ITEM_FIELDS,
  AI_TRIP_FIELDS,
  buildAiPayload,
  serializeAiPayload,
  type AiMember,
  type AiPayload,
  type AiPayloadInput,
  type PayloadMember,
  type SensitiveEntry,
} from "./payload";
export { createLogger, redactSensitive, type Logger, type LoggerOptions, type LogLevel, type RedactOptions } from "./logger";
// 測試用合成資料（outbound payload 快照測試共用）
export * as payloadFixtures from "./testing/payload-fixtures";
