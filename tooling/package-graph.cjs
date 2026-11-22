// 第 2.2 節 M-05 依賴表：套件 → 可依賴的套件。
// dependency-cruiser 規則與各套件 package.json 均由此表產生，修改依賴方向只改這裡。
module.exports = {
  schemas: [],
  core: ["schemas"],
  security: ["schemas"],
  memory: ["core", "schemas"],
  regions: ["core", "schemas"],
  offline: ["core", "schemas"],
  db: ["core", "schemas"],
  "data-sources": ["core", "schemas", "security", "regions"],
  ai: ["core", "schemas", "security", "memory"],
};
