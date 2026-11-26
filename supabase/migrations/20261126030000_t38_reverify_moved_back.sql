-- T38 修正（使用者決定 2026-11-26）：已排入的項目經提案移回候選清單時須重新核實。
-- 生命週期改為待核實、核實狀態改為未核實；每日草案、Incident Mode 的空檔候選與排入同步都只選已核實或部分核實的項目，
-- 因此重新核實（apply_verification）之前不會再被選用。上次核實時間、來源與事實主張保留。
create or replace function private.sync_lifecycle_with_schedule() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.lifecycle_status is distinct from old.lifecycle_status
     or not exists (select 1 from public.trips t where t.id = new.trip_id and t.status in ('locked', 'in_progress')) then
    return new;
  end if;
  if old.scheduled_date is null and new.scheduled_date is not null
     and old.lifecycle_status in ('candidate', 'pending_verification', 'verified')
     and old.verification_status in ('verified', 'partially_verified') then
    new.lifecycle_status := 'modified';
  elsif old.scheduled_date is not null and new.scheduled_date is null
     and old.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified') then
    new.lifecycle_status := 'pending_verification';
    -- Conflict 保留為 Conflict，其餘一律回到未核實
    if new.verification_status <> 'conflict' then
      new.verification_status := 'unverified';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_lifecycle_with_schedule() from public, anon, authenticated, service_role;
grant execute on function private.sync_lifecycle_with_schedule() to atps_change_writer;
