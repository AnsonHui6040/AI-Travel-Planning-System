import type { MemoryReader } from "@atps/core";

// MemoryReader 預設實作：回傳空記憶。T41 依第 5 節實作合併、最保守值與範圍過濾的完整版本
export const emptyMemoryReader: MemoryReader = {
  read: async () => [],
};

export * from "./merge";
