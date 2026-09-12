-- A rolling window prevents a calendar-month reset from overrunning a differently dated
-- Trigger billing cycle. Reservations are deliberately not refunded after failures/deletion.
create table public.processing_reservations(id uuid primary key default gen_random_uuid(),reserved_usd numeric(10,5) not null check(reserved_usd>0),created_at timestamptz not null default now());
alter table public.processing_reservations enable row level security;
revoke all on public.processing_reservations from anon,authenticated;
grant all on public.processing_reservations to service_role;
create or replace function public.fieldops_reserve_job() returns void language plpgsql security definer set search_path='' as $$
declare cycle_key text:=to_char(now() at time zone 'UTC','YYYY-MM'); used numeric; rolling_used numeric; begin
 perform pg_advisory_xact_lock(hashtext('fieldops-free-compute-budget'));
 insert into public.processing_budget(cycle) values(cycle_key) on conflict do nothing;
 select reserved_usd into used from public.processing_budget where cycle=cycle_key for update;
 select coalesce(sum(reserved_usd),0) into rolling_used from public.processing_reservations where created_at>now()-interval '31 days';
 if greatest(used,rolling_used)+0.13>3.50 then raise exception 'quota'; end if;
 update public.processing_budget set reserved_usd=reserved_usd+0.13 where cycle=cycle_key;
 insert into public.processing_reservations(reserved_usd) values(0.13);
end $$;
