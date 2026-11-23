// S-10、C-04：log、錯誤訊息與 AI 請求紀錄遮罩 API key

const MASK = "[已遮罩]";
const MIN_SECRET_LENGTH = 8;

// 常見 key 與 token 格式：Anthropic、OpenAI、Google API key、Bearer token
const KNOWN_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    result = result.replace(new RegExp(escapeRegExp(secret), "g"), MASK);
  }
  for (const pattern of KNOWN_PATTERNS) result = result.replace(pattern, MASK);
  return result;
}
