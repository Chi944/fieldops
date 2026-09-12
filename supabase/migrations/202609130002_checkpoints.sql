create table public.ai_checkpoints(document_id uuid not null,owner_id uuid not null,key text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(document_id,key),foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade);
alter table public.ai_checkpoints enable row level security;
revoke all on public.ai_checkpoints from anon,authenticated;
grant all on public.ai_checkpoints to service_role;
create or replace function public.fieldops_save_checkpoint(p_run uuid,p_fence text,p_key text,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; begin
 select * into r from public.processing_runs where id=p_run for update;
 if not found or r.record->>'fence'<>p_fence or (r.record->>'cancelRequested')::boolean then return; end if;
 insert into public.ai_checkpoints(document_id,owner_id,key,result) values(r.document_id,r.owner_id,p_key,p_result) on conflict do nothing;
end $$;
create or replace function public.fieldops_retry_run(p_owner uuid,p_run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; s jsonb; begin
 select * into r from public.processing_runs where id=p_run and owner_id=p_owner for update;
 if not found then raise exception 'not_found'; end if;
 if r.record->>'stage' not in ('failed','cancelled','waiting_quota') then raise exception 'stale_revision'; end if;
 perform public.fieldops_reserve_job();
 s=(r.record-'leaseUntil'-'errorCode'-'message'-'taskRunId'-'dispatchedAt')||jsonb_build_object('stage','queued','attempt',0,'progress',0,'cancelRequested',false,'fence',gen_random_uuid(),'updatedAt',now());
 update public.processing_runs set record=s where id=p_run; return s;
end $$;
revoke all on function public.fieldops_save_checkpoint(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.fieldops_retry_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fieldops_save_checkpoint(uuid,text,text,jsonb) to service_role;
grant execute on function public.fieldops_retry_run(uuid,uuid) to service_role;
create or replace function public.fieldops_renew_lease(p_run uuid,p_fence text,p_lease_until timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.processing_runs set record=jsonb_set(record,'{leaseUntil}',to_jsonb(p_lease_until)) where id=p_run and record->>'fence'=p_fence and not (record->>'cancelRequested')::boolean and record->>'stage' not in ('ready','partial','failed','cancelled','waiting_quota');
 return found;
end $$;
revoke all on function public.fieldops_renew_lease(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fieldops_renew_lease(uuid,text,timestamptz) to service_role;
