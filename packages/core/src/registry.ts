// 第 2.3 節：每類擴充點一個註冊表。註冊時執行該擴充點的共用契約檢查，
// 不符合契約的實作無法註冊；新增實作只需註冊，不修改 packages/core。

export interface Registry<T> {
  readonly kind: string;
  register(entry: T): void;
  get(id: string): T | undefined;
  require(id: string): T;
  has(id: string): boolean;
  list(): T[];
}

export class RegistrationError extends Error {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly issues: string[],
  ) {
    super(`${kind}「${id}」不符合契約：${issues.join("；")}`);
    this.name = "RegistrationError";
  }
}

export function createRegistry<T>(options: {
  kind: string;
  idOf: (entry: T) => string;
  check: (entry: T) => string[];
}): Registry<T> {
  const entries = new Map<string, T>();
  const { kind, idOf, check } = options;

  return {
    kind,
    register(entry) {
      const id = idOf(entry);
      const issues = check(entry);
      if (entries.has(id)) issues.push("id 重複註冊");
      if (issues.length > 0) throw new RegistrationError(kind, id, issues);
      entries.set(id, entry);
    },
    get: (id) => entries.get(id),
    require(id) {
      const entry = entries.get(id);
      if (entry === undefined) throw new Error(`找不到 ${kind}「${id}」`);
      return entry;
    },
    has: (id) => entries.has(id),
    list: () => [...entries.values()],
  };
}
