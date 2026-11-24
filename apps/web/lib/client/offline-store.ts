import type { DayPack, QueuedChange } from "@atps/offline";

// T35：瀏覽器端 IndexedDB。當日包依行程保存最新一份；離線修改佇列依行程保存（SH-05）。
// 只在瀏覽器使用，資料只存在本人的裝置。登出時清除離線資料尚未實作（沒有登出畫面），見 docs/verification/T35.md。

const DB_NAME = "atps-offline";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs");
      if (!db.objectStoreNames.contains("queues")) db.createObjectStore("queues");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("無法開啟離線資料"));
  });
}

async function run<T>(store: "packs" | "queues", mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("離線資料讀寫失敗"));
    });
  } finally {
    db.close();
  }
}

export const savePack = (pack: DayPack) => run("packs", "readwrite", (s) => s.put(pack, pack.tripId));
export const loadPack = async (tripId: string): Promise<DayPack | null> => ((await run("packs", "readonly", (s) => s.get(tripId))) as DayPack | undefined) ?? null;
export const loadQueue = async (tripId: string): Promise<QueuedChange[]> =>
  ((await run("queues", "readonly", (s) => s.get(tripId))) as QueuedChange[] | undefined) ?? [];
export const saveQueue = (tripId: string, queue: QueuedChange[]) => run("queues", "readwrite", (s) => s.put(queue, tripId));
