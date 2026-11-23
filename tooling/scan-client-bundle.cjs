// C-04：掃描 client bundle（apps/web/.next/static），不得含 API key 或 service role key。
// 用法：pnpm build 後執行 node tooling/scan-client-bundle.cjs；發現即以非零狀態結束。
const { readdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const PATTERNS = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{16,}/],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
];

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

function scanClientBundle(dir, knownSecrets) {
  const secrets = knownSecrets.filter((s) => typeof s === "string" && s.length >= 8);
  const findings = [];
  for (const file of listFiles(dir)) {
    const content = readFileSync(file, "utf8");
    const relative = path.relative(dir, file).split(path.sep).join("/");
    for (const [label, pattern] of PATTERNS) {
      if (pattern.test(content)) findings.push({ file: relative, pattern: label });
    }
    if (secrets.some((s) => content.includes(s))) findings.push({ file: relative, pattern: "指定的機密值" });
  }
  return findings;
}

module.exports = { scanClientBundle };

if (require.main === module) {
  const dir = path.resolve(__dirname, "../apps/web/.next/static");
  const findings = scanClientBundle(dir, [process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""]);
  if (findings.length > 0) {
    for (const f of findings) console.error(`client bundle 含 ${f.pattern}：${f.file}`);
    process.exit(1);
  }
  console.log("client bundle 未發現 key");
}
