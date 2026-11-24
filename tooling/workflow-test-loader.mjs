import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// T24：workflow 整合測試（pnpm test:workflow）專用的 Node 模組 hook。
// @workflow/vitest 會打包 repo 內所有 workflow，產生的 bundle 由 Node 直接載入；
// 工作區套件（@atps/*）以 TypeScript 原始碼對外公開，Node 無法直接執行，所以：
// 1. packages/ 底下的 .ts 以 TypeScript 編譯器轉成 JavaScript
// 2. 相對 import 沒有副檔名時補上 .ts 或 /index.ts
// 3. .json 沒有 import attribute 時以 JSON 載入
// 4. server-only 換成空模組（測試 worker 不是 React Server 環境）
// 只在 workflow 測試 worker 註冊；Next.js build、正式執行與一般單元測試都不使用。

const PACKAGES_DIR = fileURLToPath(new URL("../packages/", import.meta.url));
const EXTENSIONS = [".ts", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!relative || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    for (const ext of EXTENSIONS) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        // 試下一個副檔名
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json") && !context.importAttributes?.type) {
    return nextLoad(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const file = fileURLToPath(url);
    if (file.startsWith(PACKAGES_DIR)) {
      const source = await readFile(file, "utf8");
      const output = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      });
      return { format: "module", source: output.outputText, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
