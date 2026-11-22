import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "node_modules", ".bin", "depcruise");
const created: string[] = [];

interface Violation {
  rule: { name: string; severity: string };
  from: string;
  to: string;
}

function probe(relPath: string, source: string): string {
  const abs = path.join(root, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  created.push(abs);
  return relPath;
}

function cruise(targets: string[]): Violation[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      bin,
      [...targets, "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
      { cwd: root, encoding: "utf8" },
    );
  } catch (error) {
    // depcruise 有 error 等級違規時以非零代碼結束，JSON 仍在 stdout
    stdout = (error as { stdout: string }).stdout;
  }
  const result = JSON.parse(stdout) as { summary: { violations: Violation[] } };
  return result.summary.violations;
}

function ruleNames(violations: Violation[]): string[] {
  return violations.filter((v) => v.rule.severity === "error").map((v) => v.rule.name);
}

afterEach(() => {
  for (const file of created.splice(0)) rmSync(file, { force: true });
});

describe("M-01 core 與 schemas 不得 import 外部服務 SDK", () => {
  it("core import 外部套件時報錯", () => {
    const file = probe("packages/core/src/__probe_external.ts", 'import "dependency-cruiser";\n');
    expect(ruleNames(cruise([file]))).toContain("m01-no-external-in-core");
  });

  it("schemas import zod 以外的外部套件時報錯", () => {
    const file = probe("packages/schemas/src/__probe_external.ts", 'import "dependency-cruiser";\n');
    expect(ruleNames(cruise([file]))).toContain("m01-schemas-only-zod");
  });
});

describe("M-05 套件依賴方向", () => {
  it("core import ai 時報錯", () => {
    const file = probe("packages/core/src/__probe_up.ts", 'import "@atps/ai";\n');
    expect(ruleNames(cruise([file]))).toContain("m05-core");
  });

  it("schemas import core 時報錯", () => {
    const file = probe("packages/schemas/src/__probe_up.ts", 'import "@atps/core";\n');
    expect(ruleNames(cruise([file]))).toContain("m05-schemas");
  });

  it("data-sources import ai 時報錯", () => {
    const file = probe("packages/data-sources/src/__probe_up.ts", 'import "@atps/ai";\n');
    expect(ruleNames(cruise([file]))).toContain("m05-data-sources");
  });

  it("套件 import apps/web 時報錯", () => {
    const file = probe(
      "packages/memory/src/__probe_app.ts",
      'import "../../../apps/web/app/page.tsx";\n',
    );
    expect(ruleNames(cruise([file]))).toContain("m05-no-app-imports");
  });

  it("ai import core、schemas、security、memory 時不報錯", () => {
    const file = probe(
      "packages/ai/src/__probe_allowed.ts",
      'import "@atps/core";\nimport "@atps/schemas";\nimport "@atps/security";\nimport "@atps/memory";\n',
    );
    expect(ruleNames(cruise([file]))).toEqual([]);
  });
});

describe("M-02 apps/web 只透過公開介面", () => {
  it("直接 import 套件內部檔案時報錯", () => {
    probe("packages/core/src/__probe_internal.ts", "export const internal = 1;\n");
    const file = probe(
      "apps/web/app/__probe_deep.ts",
      'import "../../../packages/core/src/__probe_internal.ts";\n',
    );
    expect(ruleNames(cruise([file]))).toContain("m02-web-public-interface-only");
  });
});

describe("目前的程式碼", () => {
  it("沒有任何 error 等級的違規", () => {
    expect(ruleNames(cruise(["apps", "packages"]))).toEqual([]);
  });
});
