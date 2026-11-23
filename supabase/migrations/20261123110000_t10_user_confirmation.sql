-- T10：決策 0005，L1 壓縮緩衝與事實資料更正改為需使用者確認。
-- 自動套用只剩不改動行程內容的類別（與 packages/core approvalRule 一致，由工具測試比對）。
-- 擁有者、search_path 與執行權限沿用 T09 的定義。

create or replace function public.auto_apply_proposal(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select change ->> 'changeKind' into v_kind from public.proposals where id = p_proposal_id;
  if v_kind is null or v_kind not in (
    'new_candidate', 'candidate_verification_update', 'approved_fact_invalidated'
  ) then
    raise exception '此類變更需成員批准' using errcode = '42501';
  end if;
  return private.commit_proposal(p_proposal_id, null);
end;
$$;
