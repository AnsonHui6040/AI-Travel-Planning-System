import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { scanClientBundle } = createRequire(import.meta.url)("./scan-client-bundle.cjs") as {
  scanClientBundle: (dir: string, knownSecrets: string[]) => { file: string; pattern: string }[];
};

// C-04：client bundle 不得含 API key 或 service role key
const dirs: string[] = [];
function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "atps-bundle-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("client bundle 掃描", () => {
  it("乾淨的 bundle 沒有發現", () => {
    expect(scanClientBundle(bundle({ "chunks/a.js": "console.log('hello')" }), [])).toEqual([]);
  });

  it("找出常見 key 格式", () => {
    const dir = bundle({
      "chunks/a.js": 'const k="sk-ant-api03-abcdefghijklmnopqrst"',
      "chunks/b.js": 'const g="AIzaSyA1234567890abcdefghijklmnopqrstu"',
      "chunks/c.js": 'const o="sk-proj-abcdefghijklmnopqrstuvwx"',
    });
    const files = [...new Set(scanClientBundle(dir, []).map((f) => f.file))].sort();
    expect(files).toEqual(["chunks/a.js", "chunks/b.js", "chunks/c.js"]);
  });

  it("找出指定的機密值（例如 service role key）", () => {
    const dir = bundle({ "chunks/a.js": 'x="service-role-value-1234567890"' });
    expect(scanClientBundle(dir, ["service-role-value-1234567890"])).toEqual([
      { file: "chunks/a.js", pattern: "指定的機密值" },
    ]);
  });

  it("忽略空字串與過短的指定值", () => {
    expect(scanClientBundle(bundle({ "a.js": "abc" }), ["", "a"])).toEqual([]);
  });
});
