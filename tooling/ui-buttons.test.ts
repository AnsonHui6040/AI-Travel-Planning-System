import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 按鈕採用 Meta Astryx 的邏輯與外觀（使用者 2026-11-27 選定）：
// 四種變體（primary、secondary、ghost、danger）；危險操作用 danger；不可逆操作先確認；導覽用連結不用按鈕

const root = path.resolve(import.meta.dirname, "..");
const files = globSync("apps/web/{app,components}/**/*.tsx", { cwd: root }).filter((f) => !f.endsWith(".test.tsx"));
const DANGER_LABEL = /(刪除|否決|移除|撤銷|退出)/;

interface Found {
  file: string;
  attrs: string;
  label: string;
  source: string;
}

const buttons: Found[] = files.flatMap((file) => {
  const source = readFileSync(path.join(root, file), "utf8");
  return [...source.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    file,
    attrs: m[1] as string,
    label: (m[2] as string).replace(/\s+/g, " ").trim(),
    source,
  }));
});
// className="secondary" 或 className={confirmText ? "danger" : "secondary"}：取第一個出現的變體
const variantOf = (attrs: string) => {
  const m = /className=(?:"([^"]*)"|\{([^}]*)\})/.exec(attrs);
  const text = m?.[1] ?? m?.[2] ?? "";
  // 樣板頁以型別限定為四種變體的欄位指定（className={b.variant}）
  if (/^\w+\.variant$/.test(text.trim())) return "typed";
  return text.match(/\b(primary|secondary|ghost|danger)\b/)?.[1] ?? null;
};

describe("按鈕變體", () => {
  it("找得到按鈕", () => {
    expect(buttons.length).toBeGreaterThan(30);
  });

  it.each(buttons.map((b) => [`${b.file}：${b.label.slice(0, 30)}`, b] as const))("%s 有變體", (_name, b) => {
    expect(variantOf(b.attrs)).not.toBeNull();
  });

  it.each(buttons.filter((b) => DANGER_LABEL.test(b.label)).map((b) => [`${b.file}：${b.label.slice(0, 30)}`, b] as const))(
    "%s 為 danger",
    (_name, b) => {
      expect(variantOf(b.attrs)).toBe("danger");
    },
  );
});

describe("不可逆操作先確認", () => {
  // 會寫入資料庫的危險操作；基線表單的「刪除航班」等只移除尚未儲存的列，不需確認
  const persisted = [
    "apps/web/app/settings/memories/memory-forms.tsx",
    "apps/web/app/settings/api-keys/api-key-forms.tsx",
    "apps/web/app/trips/[tripId]/proposals/proposal-forms.tsx",
    "apps/web/app/trips/[tripId]/members/member-forms.tsx",
    "apps/web/app/trips/[tripId]/timeline/timeline-forms.tsx",
    "apps/web/app/trips/[tripId]/expenses/expense-forms.tsx",
  ];
  it.each(persisted)("%s 送出前以 window.confirm 確認", (file) => {
    expect(readFileSync(path.join(root, file), "utf8")).toContain("window.confirm(");
  });
});
