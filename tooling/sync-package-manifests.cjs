// 依 package-graph.cjs 產生 packages/*/package.json 與 tsconfig.json。
// 用法：node tooling/sync-package-manifests.cjs
const fs = require("node:fs");
const path = require("node:path");
const graph = require("./package-graph.cjs");

const root = path.resolve(__dirname, "..");

for (const [name, deps] of Object.entries(graph)) {
  const dir = path.join(root, "packages", name);
  const manifestPath = path.join(dir, "package.json");
  const existing = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};
  const external = Object.fromEntries(
    Object.entries(existing.dependencies ?? {}).filter(([d]) => !d.startsWith("@atps/")),
  );
  const manifest = {
    name: `@atps/${name}`,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    scripts: { typecheck: "tsc --noEmit", build: "tsc --noEmit" },
    dependencies: {
      ...external,
      ...Object.fromEntries(deps.map((d) => [`@atps/${d}`, "workspace:*"])),
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    `${JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src"] }, null, 2)}\n`,
  );
}
