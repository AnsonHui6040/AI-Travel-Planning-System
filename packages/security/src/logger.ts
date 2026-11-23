import { redactSecrets } from "./redact";

// T17、S-10、C-04：log 與 AI 請求紀錄遮罩 API key 與敏感欄位

const MASK = "[已遮罩]";
// 敏感欄位值可能很短（例如兩個字的全名），比 API key 的門檻低
const MIN_SENSITIVE_LENGTH = 2;
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/g;
// 以 + 或 0 開頭的電話號碼；日期與時間不會符合
const PHONE = /(?:\+\d{1,3}[\s-]?|\b0)\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RedactOptions {
  secrets?: readonly string[];
  sensitiveValues?: readonly string[];
}

export function redactSensitive(text: string, options: RedactOptions): string {
  let result = redactSecrets(text, options.secrets ?? []);
  const values = [...(options.sensitiveValues ?? [])].filter((v) => v.length >= MIN_SENSITIVE_LENGTH).sort((a, b) => b.length - a.length);
  for (const value of values) result = result.replace(new RegExp(escapeRegExp(value), "g"), MASK);
  return result.replace(EMAIL, MASK).replace(PHONE, MASK);
}

export type LogLevel = "info" | "warn" | "error";

export interface LoggerOptions {
  write?: (line: string) => void;
  secrets?: () => readonly string[];
  sensitiveValues?: () => readonly string[];
  now?: () => Date;
}

export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[循環]";
        seen.add(v);
      }
      if (v instanceof Error) return { name: v.name, message: v.message };
      return v;
    });
  } catch {
    return '"[無法序列化]"';
  }
}

// 每一行是 JSON；寫出前整行遮罩，附帶資料裡的值也一併處理
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const emit = (level: LogLevel, message: string, data?: unknown) => {
    const raw = `{"level":${JSON.stringify(level)},"time":${JSON.stringify(now().toISOString())},"message":${JSON.stringify(message)}${
      data === undefined ? "" : `,"data":${safeStringify(data)}`
    }}`;
    write(redactSensitive(raw, { secrets: options.secrets?.() ?? [], sensitiveValues: options.sensitiveValues?.() ?? [] }));
  };
  return {
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
  };
}
