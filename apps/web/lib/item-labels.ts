// 決策 0010：項目類型與核實狀態的畫面文字（行程、項目詳情、編輯共用）

export const ITEM_TYPE_LABELS = {
  attraction: "景點",
  restaurant: "餐飲",
  shopping: "購物",
  photography: "攝影",
  activity: "活動",
} as const;

export const VERIFICATION_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
  user_confirmed: "使用者確認",
};

// 決策 0011：兩站之間的交通方式（成員輸入）與 T28 估算的交通方式
export const TRAVEL_MODE_LABELS: Record<string, string> = {
  walk: "步行",
  train: "電車",
  bus: "公車",
  taxi: "計程車",
  car: "開車",
  rail: "鐵路與地鐵",
  drive: "自駕",
};

export const USER_TRAVEL_MODES = ["walk", "train", "bus", "taxi", "car"] as const;
