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
