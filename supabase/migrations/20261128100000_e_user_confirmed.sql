-- 決策 0010 E：成員自行新增的項目使用新的核實狀態「使用者確認」（user_confirmed）。
-- 新的 enum 值要在另一個交易才能使用，所以單獨一個 migration。
alter type public.verification_status add value if not exists 'user_confirmed';
