// 第 2.2 節依賴規則（M-01、M-02、M-03、M-05）。依賴表在 tooling/package-graph.cjs。
const graph = require("./tooling/package-graph.cjs");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 未宣告依賴的套件在 pnpm 下無法解析，此時 to.path 為模組名稱，故同時比對
// 解析後路徑（packages/<name>/）與模組名稱（@atps/<name>）。
const m05Rules = Object.entries(graph).map(([pkg, allowed]) => {
  const ok = [pkg, ...allowed].map(escapeRe).join("|");
  return {
    name: `m05-${pkg}`,
    severity: "error",
    comment: `M-05：packages/${pkg} 只可依賴 ${allowed.length ? allowed.join("、") : "無"}`,
    from: { path: `^packages/${escapeRe(pkg)}/` },
    to: { path: `^(packages/|@atps/)(?!(${ok})(/|$))` },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "m01-no-external-in-core",
      severity: "error",
      comment: "M-01：packages/core 不得 import 任何外部套件",
      from: { path: "^packages/core/", pathNot: "\\.test\\.ts$" },
      to: { path: "node_modules" },
    },
    {
      name: "m01-no-builtins-in-core",
      severity: "error",
      comment: "M-01：packages/core 不得使用 Node 內建模組，時間與 I/O 經由 port",
      from: { path: "^packages/core/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "m01-schemas-only-zod",
      severity: "error",
      comment: "M-01：packages/schemas 只可 import zod",
      from: { path: "^packages/schemas/", pathNot: "\\.test\\.ts$" },
      to: {
        path: "node_modules",
        // pnpm 實際路徑為 node_modules/.pnpm/zod@x/node_modules/zod/，同樣含此字串
        pathNot: "node_modules/zod/",
      },
    },
    {
      name: "m01-no-builtins-in-schemas",
      severity: "error",
      comment: "M-01：packages/schemas 不得使用 Node 內建模組",
      from: { path: "^packages/schemas/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["core"] },
    },
    ...m05Rules,
    {
      name: "m05-no-app-imports",
      severity: "error",
      comment: "套件不得依賴 apps",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "m02-web-public-interface-only",
      severity: "error",
      comment: "M-02：apps/web 只可經 @atps/<套件> 的公開介面（src/index.ts）使用套件",
      from: { path: "^apps/web/" },
      to: { path: "^packages/", pathNot: "^packages/[^/]+/src/index\\.ts$" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "不得有循環依賴",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "無法解析的 import",
      from: {},
      to: { couldNotResolve: true, pathNot: "^@atps/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // node_modules 不可放在 exclude，否則外部依賴會整條被略過，M-01 檢查失效
    // next-env.d.ts 由 next build 產生且不納入版本控制
    exclude: { path: "(^|/)((\\.next|\\.workflow-vitest|\\.workflow-data|\\.well-known|test-results|playwright-report)/|next-env\\.d\\.ts$)" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
