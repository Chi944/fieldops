-- Explicit job intent: legacy uploads are parsing-only until deliberately resubmitted.
-- Generated with Supabase CLI; timestamp advanced after the pre-existing future-dated
-- 20260913 migrations so fresh installations apply this after their prerequisites.
update public.documents set record=record||'{"processingMode":"parse_only"}'::jsonb where not record ? 'processingMode';
update public.processing_runs set record=record||'{"processingMode":"parse_only"}'::jsonb where not record ? 'processingMode';
alter table public.documents add constraint document_processing_mode check(record->>'processingMode' in ('parse_only','ai'));
alter table public.processing_runs add constraint run_processing_mode check(record->>'processingMode' in ('parse_only','ai'));

create or replace function public.fieldops_pending_runs() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(record),'[]') from (select r.record from public.processing_runs r join public.documents d on d.id=r.document_id join public.comparisons c on c.id=r.comparison_id where d.deleted_at is null and c.deleted_at is null
 and (r.record->>'stage' not in ('ready','source_ready','partial','failed','cancelled','waiting_quota') or (r.record->>'stage'='waiting_quota' and r.record->>'processingMode'='ai' and (r.record->>'retryAfter')::timestamptz<=now()))
 and not (r.record->>'cancelRequested')::boolean and coalesce((r.record->>'leaseUntil')::timestamptz,'epoch')<now() order by r.created_at limit 25) s;
$$;

create or replace function public.fieldops_save_run(p_record jsonb,p_expected_fence text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; begin
 select * into r from public.processing_runs where id=(p_record->>'id')::uuid and owner_id=(p_record->>'ownerId')::uuid for update;
 if not found then return false; end if;
 if coalesce(p_record->>'processingMode','parse_only')<>coalesce(r.record->>'processingMode','parse_only') then return false; end if;
 if p_expected_fence is not null and r.record->>'fence'<>p_expected_fence then return false; end if;
 if (r.record->>'cancelRequested')::boolean and not (p_record->>'cancelRequested')::boolean then return false; end if;
 if p_expected_fence is not null and r.record->>'stage' in ('ready','source_ready','partial','failed','cancelled','waiting_quota') and r.record->>'stage'<>p_record->>'stage' then return false; end if;
 update public.processing_runs set record=jsonb_set(p_record||jsonb_build_object('processingMode',coalesce(r.record->>'processingMode','parse_only')),'{updatedAt}',to_jsonb(now())) where id=r.id; return true;
end $$;

create or replace function public.fieldops_claim_run(p_run uuid,p_fence text,p_lease_until timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; s jsonb; quota_resume boolean; begin
 select * into r from public.processing_runs where id=p_run for update;
 if not found then return null; end if;
 quota_resume=r.record->>'stage'='waiting_quota' and r.record->>'processingMode'='ai' and coalesce((r.record->>'retryAfter')::timestamptz,'infinity')<=now();
 if (r.record->>'stage' in ('ready','source_ready','partial','failed','cancelled','waiting_quota') and not quota_resume) or (r.record->>'cancelRequested')::boolean or coalesce((r.record->>'leaseUntil')::timestamptz,'epoch')>now() then return null; end if;
 if not exists(select 1 from public.documents d join public.comparisons c on c.id=d.comparison_id where d.id=r.document_id and d.deleted_at is null and c.deleted_at is null) then return null; end if;
 s=(r.record-'retryAfter')||jsonb_build_object('fence',p_fence,'leaseUntil',p_lease_until,'attempt',(r.record->>'attempt')::int+case when quota_resume then 0 else 1 end,'stage','validating','updatedAt',now());
 update public.processing_runs set record=s where id=p_run; return s;
end $$;

create or replace function public.fieldops_save_parsed(p_run uuid,p_fence text,p_parsed jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; v jsonb; begin
 select * into r from public.processing_runs where id=p_run for update;
 if not found or r.record->>'stage' in ('source_ready','ready','partial','failed','cancelled','waiting_quota') or r.record->>'fence'<>p_fence or (r.record->>'cancelRequested')::boolean then return; end if;
 insert into public.parsed_documents(document_id,owner_id,record) values(r.document_id,r.owner_id,p_parsed) on conflict(document_id) do update set record=excluded.record;
 delete from public.source_spans where document_id=r.document_id;
 for v in select value from jsonb_array_elements(p_parsed->'sources') loop
  insert into public.source_spans(id,document_id,owner_id,kind,location) values(v->>'id',r.document_id,r.owner_id,v->>'kind',v);
 end loop;
end $$;

create or replace function public.fieldops_complete_run(p_run uuid,p_fence text,p_quotation jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; c public.comparisons; s jsonb; q jsonb; items jsonb='[]'; idx int; extraction uuid; v jsonb; has_corrections boolean; begin
 select * into r from public.processing_runs where id=p_run for update;
 if not found or coalesce(r.record->>'processingMode','parse_only')<>'ai' or r.record->>'fence'<>p_fence or (r.record->>'cancelRequested')::boolean or r.record->>'stage' in ('ready','source_ready','partial','failed','cancelled','waiting_quota') then return false; end if;
 select * into c from public.comparisons where id=r.comparison_id and owner_id=r.owner_id and deleted_at is null for update;
 if not found or not exists(select 1 from public.documents where id=r.document_id and deleted_at is null and record->>'status'='uploaded' and record->>'processingMode'='ai') then return false; end if;
 select value into q from jsonb_array_elements(c.snapshot->'quotations') where value->>'documentId'=r.document_id::text;
 if q is null or (q->>'extractionVersion')::int>=(r.record->>'extractionVersion')::int then return false; end if;
 insert into public.extraction_versions(document_id,owner_id,version,quotation) values(r.document_id,r.owner_id,(r.record->>'extractionVersion')::int,p_quotation) returning id into extraction;
 for v in select value from jsonb_array_elements(p_quotation->'items') loop
  insert into public.quotation_items(id,extraction_id,owner_id,kind,fields) values(v->>'id',extraction,r.owner_id,v->>'kind',v);
 end loop;
 select exists(select 1 from jsonb_array_elements(c.snapshot->'corrections') where value->>'quotationId'=q->>'id') into has_corrections;
 if not has_corrections then
  for v in select value from jsonb_array_elements(c.snapshot->'quotations') loop
   items=items||jsonb_build_array(case when v->>'documentId'=r.document_id::text then p_quotation else v end);
  end loop;
  s=jsonb_set(c.snapshot,'{quotations}',items);
  s=jsonb_set(s,'{groups}',coalesce((select jsonb_agg(case when value->>'status'='approved' then value||'{"status":"stale"}'::jsonb else value end) from jsonb_array_elements(s->'groups')),'[]'));
 else s=c.snapshot; end if;
 perform public.fieldops_save_comparison(r.owner_id,s,c.revision);
 update public.processing_runs set record=(record-'leaseUntil')||jsonb_build_object('stage',case when has_corrections then 'partial' else p_quotation->>'status' end,'progress',100,'updatedAt',now(),'message',case when has_corrections then 'New extraction saved separately; your corrections were preserved.' else 'Extraction ready for review.' end) where id=p_run;
 return true;
end $$;

create or replace function public.fieldops_retry_run(p_owner uuid,p_run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.processing_runs; s jsonb; begin
 select * into r from public.processing_runs where id=p_run and owner_id=p_owner for update;
 if not found then raise exception 'not_found'; end if;
 if r.record->>'stage' not in ('failed','cancelled','waiting_quota') then raise exception 'stale_revision'; end if;
 perform public.fieldops_reserve_job();
 s=(r.record-'leaseUntil'-'errorCode'-'message'-'taskRunId'-'dispatchedAt'-'retryAfter')||jsonb_build_object('stage','queued','attempt',0,'progress',0,'cancelRequested',false,'quotaWaits',0,'fence',gen_random_uuid(),'updatedAt',now());
 update public.processing_runs set record=s where id=p_run; return s;
end $$;

create or replace function public.fieldops_renew_lease(p_run uuid,p_fence text,p_lease_until timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.processing_runs set record=jsonb_set(record,'{leaseUntil}',to_jsonb(p_lease_until)) where id=p_run and record->>'fence'=p_fence and not (record->>'cancelRequested')::boolean and record->>'stage' not in ('ready','source_ready','partial','failed','cancelled','waiting_quota');
 return found;
end $$;

create or replace function public.fieldops_create_upload(p_owner uuid,p_document jsonb,p_run jsonb,p_quotation jsonb,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.comparisons; s jsonb; selected_mode text; begin
 selected_mode=coalesce(p_document->>'processingMode','parse_only');
 if selected_mode not in ('parse_only','ai') then raise exception 'invalid_processing_mode'; end if;
 p_document=p_document||jsonb_build_object('processingMode',selected_mode);
 if p_run is not null then
  if coalesce(p_run->>'processingMode','parse_only')<>selected_mode then raise exception 'processing_mode_mismatch'; end if;
  p_run=p_run||jsonb_build_object('processingMode',selected_mode);
 end if;
 select * into c from public.comparisons where id=(p_document->>'comparisonId')::uuid and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if c.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 if jsonb_array_length(c.snapshot->'quotations')>=5 then raise exception 'quota'; end if;
 if p_run is not null then perform public.fieldops_reserve_job(); end if;
 insert into public.documents(id,comparison_id,owner_id,content_hash,storage_path,record) values((p_document->>'id')::uuid,c.id,p_owner,p_document->>'contentHash',p_document->>'storagePath',p_document);
 if p_run is not null then
  insert into public.processing_runs(id,document_id,comparison_id,owner_id,record) values((p_run->>'id')::uuid,(p_document->>'id')::uuid,c.id,p_owner,p_run);
 end if;
 s=jsonb_set(c.snapshot,'{quotations}',(c.snapshot->'quotations')||jsonb_build_array(p_quotation));
 perform public.fieldops_save_comparison(p_owner,s,c.revision);
end $$;

create or replace function public.fieldops_finalize_upload(p_owner uuid,p_document uuid,p_hash text,p_run jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents; begin
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if d.record->>'status'<>'uploading' then return; end if;
 if coalesce(p_run->>'processingMode','parse_only')<>coalesce(d.record->>'processingMode','parse_only') then raise exception 'processing_mode_mismatch'; end if;
 p_run=p_run||jsonb_build_object('processingMode',coalesce(d.record->>'processingMode','parse_only'));
 perform public.fieldops_reserve_job();
 update public.documents set content_hash=p_hash,record=jsonb_set(jsonb_set(record,'{status}','"uploaded"'),'{contentHash}',to_jsonb(p_hash)) where id=p_document;
 insert into public.processing_runs(id,document_id,comparison_id,owner_id,record) values((p_run->>'id')::uuid,p_document,d.comparison_id,p_owner,p_run);
end $$;
