import { describe, expect, it } from "vitest";
import {
  restorePreview,
  restoreVersion,
  type ItineraryItem,
  type RestoreResult,
  type VersionRestorer,
  type VersionRow,
} from "./index";

const A = "30000000-0000-4000-8000-000000000001";
const B = "30000000-0000-4000-8000-000000000002";
const C = "30000000-0000-4000-8000-000000000003";
const VERSION = "50000000-0000-4000-8000-000000000001";

const item = (id: string, date: string | null, start: string | null, end: string | null) =>
  ({ id, scheduled_date: date, scheduled_start: start, scheduled_end: end }) as unknown as ItineraryItem;

const slot = (itemId: string, date: string | null, start: string | null, end: string | null) => ({
  itemId,
  date,
  start,
  end,
});

const version = (snapshot: unknown) => ({ id: VERSION, snapshot }) as unknown as VersionRow;

describe("restorePreview：比較目前行程與所選版本", () => {
  it("只列出不同的項目，同一天改時間為 Minor", () => {
    const preview = restorePreview(
      [slot(A, "2026-12-01", "10:00", "11:30"), slot(B, "2026-12-01", "13:00", "14:00")],
      [item(A, "2026-12-01", "14:00", "15:30"), item(B, "2026-12-01", "13:00", "14:00")],
    );
    expect(preview).toEqual({
      changes: [
        {
          itemId: A,
          from: { date: "2026-12-01", start: "14:00", end: "15:30" },
          to: { date: "2026-12-01", start: "10:00", end: "11:30" },
        },
      ],
      versionKind: "minor",
    });
  });

  it("項目回到另一天為 Major", () => {
    const preview = restorePreview([slot(A, "2026-12-01", "10:00", "11:30")], [item(A, "2026-12-02", "10:00", "11:30")]);
    expect(preview.versionKind).toBe("major");
  });

  it("同時影響兩天以上為 Major", () => {
    const preview = restorePreview(
      [slot(A, "2026-12-01", "10:00", "11:00"), slot(B, "2026-12-02", "10:00", "11:00")],
      [item(A, "2026-12-01", "12:00", "13:00"), item(B, "2026-12-02", "12:00", "13:00")],
    );
    expect(preview.versionKind).toBe("major");
  });

  it("所選版本之後才排入的項目，復原後改回未排程", () => {
    const preview = restorePreview([slot(A, "2026-12-01", "10:00", "11:00")], [
      item(A, "2026-12-01", "10:00", "11:00"),
      item(C, "2026-12-01", "15:00", "16:00"),
    ]);
    expect(preview.changes).toEqual([
      { itemId: C, from: { date: "2026-12-01", start: "15:00", end: "16:00" }, to: { date: null, start: null, end: null } },
    ]);
  });

  it("行程已與所選版本相同時沒有差異", () => {
    expect(restorePreview([slot(A, "2026-12-01", "10:00", "11:00")], [item(A, "2026-12-01", "10:00", "11:00")])).toEqual({
      changes: [],
      versionKind: "minor",
    });
  });

  it("快照格式不符時拋出", () => {
    expect(() => restorePreview([{ itemId: A }], [])).toThrow();
  });
});

function fakeRestorer(result: RestoreResult = { version: { major: 3, minor: 0 }, versionId: VERSION }) {
  const calls: unknown[] = [];
  const restorer: VersionRestorer = {
    restore: async (input) => {
      calls.push(input);
      return result;
    },
  };
  return { restorer, calls };
}

describe("restoreVersion：建立內容相同的新版本", () => {
  it("有差異時交給寫入角色，傳入版本編號與 base version", async () => {
    const { restorer, calls } = fakeRestorer();
    const result = await restoreVersion(
      { restorer },
      {
        version: version([slot(A, "2026-12-01", "10:00", "11:00")]),
        items: [item(A, "2026-12-01", "12:00", "13:00")],
        baseVersion: 4,
      },
    );
    expect(calls).toEqual([{ versionId: VERSION, baseVersion: 4 }]);
    expect(result).toEqual({ version: { major: 3, minor: 0 }, versionId: VERSION });
  });

  it("沒有差異時拒絕，不建立新版本", async () => {
    const { restorer, calls } = fakeRestorer();
    await expect(
      restoreVersion(
        { restorer },
        { version: version([slot(A, "2026-12-01", "10:00", "11:00")]), items: [item(A, "2026-12-01", "10:00", "11:00")], baseVersion: 4 },
      ),
    ).rejects.toThrow("目前行程已與此版本相同");
    expect(calls).toEqual([]);
  });

  it("舊版本沒有完整行程紀錄時拒絕", async () => {
    const { restorer, calls } = fakeRestorer();
    await expect(restoreVersion({ restorer }, { version: version(null), items: [], baseVersion: 4 })).rejects.toThrow(
      "此版本沒有完整行程紀錄",
    );
    expect(calls).toEqual([]);
  });
});
