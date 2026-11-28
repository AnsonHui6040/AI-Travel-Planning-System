// 決策 0010 I、S-07：行程匯入時貼上的文字（確認信、其他 App 匯出的行程、自己的清單）送 AI 前的處理。
// 與 buildAiPayload 相同的原則：全名、電話、電子郵件不送 AI。貼上的是自由文字，沒有欄位可挑選，因此：
// 1. 成員已登錄、本人看得到的全名、電話、電子郵件（knownValues）一律換成標記
// 2. 電子郵件與電話號碼（+ 國碼或 0 開頭）換成標記
// 3. 標示為姓名的行（姓名、氏名、Guest name、Passenger 等）把值換成標記
// 預約碼、日期、時間、航班編號保留，供 AI 辨識；結果只回到使用者本人的預覽（不寫入 log、不保存）。

export const IMPORT_TEXT_MAX = 20_000;

export interface ImportPayload {
  text: string;
  removed: { email: number; phone: number; name: number };
  truncated: boolean;
}

const MARK = { email: "〔已移除電子郵件〕", phone: "〔已移除電話〕", name: "〔已移除姓名〕" } as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// + 國碼開頭，或 0 開頭的市話與手機（日期以 2 開頭，不會被當成電話）
const PHONE = /(?<![\w-])(?:\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,3}|0\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4})(?![\w-])/g;
const NAME_LABELS = [
  "姓名",
  "預訂者姓名",
  "訂購人姓名",
  "旅客姓名",
  "乘客姓名",
  "住客姓名",
  "聯絡人",
  "預訂者",
  "訂購人",
  "代表者",
  "予約者",
  "宿泊者",
  "氏名",
  "お名前",
  "名前",
  "Name",
  "Full name",
  "Guest",
  "Guest name",
  "Lead guest",
  "Passenger",
  "Passenger name",
  "Traveler",
  "Traveller",
  "Lead traveler",
  "Booker",
  "Booked by",
  "Contact name",
];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const NAME_LINE = new RegExp(`^([ \\t]*(?:${NAME_LABELS.map(escape).join("|")})[ \\t]*[：:][ \\t]*)(\\S[^\\n]*)$`, "gim");

function kindOf(value: string): keyof typeof MARK {
  if (value.includes("@")) return "email";
  if (/^[+\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 6) return "phone";
  return "name";
}

export function buildImportPayload(raw: string, options: { knownValues: readonly string[] }): ImportPayload {
  const removed = { email: 0, phone: 0, name: 0 };
  let text = raw.replace(/\r\n?/g, "\n").trim();

  const known = [...new Set(options.knownValues.map((v) => v.trim()).filter((v) => v.length >= 2))].sort((a, b) => b.length - a.length);
  for (const value of known) {
    const kind = kindOf(value);
    const pattern = new RegExp(value.split(/\s+/).map(escape).join("\\s+"), "gi");
    text = text.replace(pattern, () => {
      removed[kind] += 1;
      return MARK[kind];
    });
  }
  text = text.replace(EMAIL, () => {
    removed.email += 1;
    return MARK.email;
  });
  text = text.replace(PHONE, () => {
    removed.phone += 1;
    return MARK.phone;
  });
  text = text.replace(NAME_LINE, (_line, label: string, value: string) => {
    if (value.trim() === MARK.name) return `${label}${value}`;
    removed.name += 1;
    return `${label}${MARK.name}`;
  });

  const chars = [...text];
  const truncated = chars.length > IMPORT_TEXT_MAX;
  return { text: truncated ? chars.slice(0, IMPORT_TEXT_MAX).join("") : text, removed, truncated };
}
