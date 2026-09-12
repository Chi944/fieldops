-- Quota waiting is durable suspension, not an execution failure or a reason to call a paid model.
create or replace function public.fieldops_pending_runs() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(record),'[]') from (select r.record from public.processing_runs r join public.documents d on d.id=r.document_id join public.comparisons c on c.id=r.comparison_id where d.deleted_at is null and c.deleted_at is null
 and (r.record->>'stage' not in ('ready','partial','failed','cancelled','waiting_quota') or (r.record->>'stage'='waiting_quota' and (r.record->>'retryAfter')::timestamptz<=now()))
 and not (r.record->>'cancelRequested')::boolean and coalesce((r.record->>'leaseUntil')::timestamptz,'epoch')<now() order by r.created_at limit 25) s;
$$;
create or replace function public.fieldops_claim_run(p_run uuid,p_fence text,p_lease_until timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; s jsonb; quota_resume boolean; begin
 select * into r from public.processing_runs where id=p_run for update;
 if not found then return null; end if;
 quota_resume=r.record->>'stage'='waiting_quota' and coalesce((r.record->>'retryAfter')::timestamptz,'infinity')<=now();
 if (r.record->>'stage' in ('ready','partial','failed','cancelled','waiting_quota') and not quota_resume) or (r.record->>'cancelRequested')::boolean or coalesce((r.record->>'leaseUntil')::timestamptz,'epoch')>now() then return null; end if;
 if not exists(select 1 from public.documents d join public.comparisons c on c.id=d.comparison_id where d.id=r.document_id and d.deleted_at is null and c.deleted_at is null) then return null; end if;
 s=(r.record-'retryAfter')||jsonb_build_object('fence',p_fence,'leaseUntil',p_lease_until,'attempt',(r.record->>'attempt')::int+case when quota_resume then 0 else 1 end,'stage','validating','updatedAt',now());
 update public.processing_runs set record=s where id=p_run; return s;
end $$;
