-- FieldOps Neon baseline. Derived from the six tested FieldOps migrations, consolidated to their latest definitions.
-- Requires Neon Auth managed neon_auth user/account/session tables (UUID IDs, inspected on the dedicated project).
-- Run once as the migration owner; never with the application runtime login.
-- Personal workspaces; immutable document/extraction revisions and typed JSON field values.
create extension if not exists pgcrypto;
create table public.invited_accounts (github_user_id text primary key, label text not null default '', active boolean not null default true, created_at timestamptz not null default now());
create table public.workspaces (id uuid primary key references neon_auth."user"(id) on delete cascade, owner_id uuid not null unique references neon_auth."user"(id) on delete cascade, name text not null default 'My workspace', created_at timestamptz not null default now());
create table public.comparisons (id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references neon_auth."user"(id) on delete cascade, revision integer not null check(revision >= 0), snapshot jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, unique(id,owner_id), check(jsonb_typeof(snapshot)='object'));
create table public.documents (id uuid primary key, comparison_id uuid not null, owner_id uuid not null, content_hash text not null, storage_path text not null unique, record jsonb not null, created_at timestamptz not null default now(), deleted_at timestamptz, foreign key(comparison_id,owner_id) references public.comparisons(id,owner_id) on delete cascade, unique(id,owner_id));
create index documents_duplicate on public.documents(owner_id,comparison_id,content_hash) where deleted_at is null;
create table public.processing_runs (id uuid primary key, document_id uuid not null, comparison_id uuid not null, owner_id uuid not null, record jsonb not null, created_at timestamptz not null default now(), foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade, foreign key(comparison_id,owner_id) references public.comparisons(id,owner_id) on delete cascade);
create index processing_runs_pending on public.processing_runs((record->>'stage'));
create table public.parsed_documents (document_id uuid primary key references public.documents(id) on delete cascade, owner_id uuid not null references neon_auth."user"(id), record jsonb not null, created_at timestamptz not null default now());
create table public.extraction_versions (id uuid primary key default gen_random_uuid(), document_id uuid not null, owner_id uuid not null, version integer not null, schema_version text not null default '1', quotation jsonb not null, created_at timestamptz not null default now(), foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade, unique(document_id,version));
create table public.source_spans (id text not null, document_id uuid not null, owner_id uuid not null, kind text not null, location jsonb not null, primary key(document_id,id), foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade);
create table public.quotation_items (id text not null, extraction_id uuid not null references public.extraction_versions(id) on delete cascade, owner_id uuid not null references neon_auth."user"(id), kind text not null, fields jsonb not null, primary key(extraction_id,id));
create table public.corrections (id uuid primary key, comparison_id uuid not null, owner_id uuid not null, record jsonb not null, created_at timestamptz not null default now(), foreign key(comparison_id,owner_id) references public.comparisons(id,owner_id) on delete cascade);
create table public.match_groups (id text not null, comparison_id uuid not null, owner_id uuid not null, record jsonb not null, primary key(comparison_id,id), foreign key(comparison_id,owner_id) references public.comparisons(id,owner_id) on delete cascade);
create table public.comparison_versions (comparison_id uuid not null, version integer not null, owner_id uuid not null, snapshot jsonb not null, created_at timestamptz not null default now(), primary key(comparison_id,version), foreign key(comparison_id,owner_id) references public.comparisons(id,owner_id) on delete cascade);
create table public.deletion_outbox (id uuid primary key default gen_random_uuid(), owner_id uuid not null, storage_path text not null, created_at timestamptz not null default now());
create table public.processing_budget (cycle text primary key, reserved_usd numeric(10,5) not null default 0 check(reserved_usd >= 0));


create table public.ai_checkpoints(document_id uuid not null,owner_id uuid not null,key text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(document_id,key),foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade);

create table public.processing_reservations(id uuid primary key default gen_random_uuid(),reserved_usd numeric(10,5) not null check(reserved_usd>0),created_at timestamptz not null default now());
update public.documents set record=record||'{"processingMode":"parse_only"}'::jsonb where not record ? 'processingMode';
update public.processing_runs set record=record||'{"processingMode":"parse_only"}'::jsonb where not record ? 'processingMode';
alter table public.documents add constraint document_processing_mode check(record->>'processingMode' in ('parse_only','ai'));
alter table public.processing_runs add constraint run_processing_mode check(record->>'processingMode' in ('parse_only','ai'));


create or replace function public.fieldops_snapshot(p_owner uuid,p_snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c uuid := (p_snapshot->>'id')::uuid; v jsonb; begin
 insert into public.comparison_versions(comparison_id,version,owner_id,snapshot) values(c,(p_snapshot->>'revision')::int,p_owner,p_snapshot) on conflict do nothing;
 for v in select value from jsonb_array_elements(coalesce(p_snapshot->'corrections','[]')) loop
  insert into public.corrections(id,comparison_id,owner_id,record) values((v->>'id')::uuid,c,p_owner,v) on conflict(id) do nothing;
 end loop;
 delete from public.match_groups where comparison_id=c and owner_id=p_owner;
 for v in select value from jsonb_array_elements(coalesce(p_snapshot->'groups','[]')) loop
  insert into public.match_groups(id,comparison_id,owner_id,record) values(v->>'id',c,p_owner,v);
 end loop;
end $$;

create or replace function public.fieldops_create_comparison(p_owner uuid,p_snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspaces(id,owner_id) values(p_owner,p_owner) on conflict(id) do nothing;
 insert into public.comparisons(id,workspace_id,owner_id,revision,snapshot) values((p_snapshot->>'id')::uuid,p_owner,p_owner,(p_snapshot->>'revision')::int,p_snapshot);
 perform public.fieldops_snapshot(p_owner,p_snapshot);
end $$;

create or replace function public.fieldops_save_comparison(p_owner uuid,p_snapshot jsonb,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.comparisons; s jsonb; begin
 select * into c from public.comparisons where id=(p_snapshot->>'id')::uuid and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if c.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 s=jsonb_set(jsonb_set(p_snapshot,'{revision}',to_jsonb(p_expected_revision+1)),'{updatedAt}',to_jsonb(now()));
 update public.comparisons set snapshot=s,revision=p_expected_revision+1,updated_at=now() where id=c.id;
 perform public.fieldops_snapshot(p_owner,s);
end $$;

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

create or replace function public.fieldops_delete_comparison(p_owner uuid,p_comparison uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.comparisons where id=p_comparison and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 insert into public.deletion_outbox(owner_id,storage_path) select p_owner,storage_path from public.documents where comparison_id=p_comparison and owner_id=p_owner;
 delete from public.comparisons where id=p_comparison and owner_id=p_owner;
end $$;

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
 s=(r.record-'leaseUntil'-'errorCode'-'message'-'taskRunId'-'dispatchedAt'-'retryAfter')||jsonb_build_object('stage','queued','attempt',0,'progress',0,'cancelRequested',false,'quotaWaits',0,'fence',gen_random_uuid(),'updatedAt',now());
 update public.processing_runs set record=s where id=p_run; return s;
end $$;

create or replace function public.fieldops_renew_lease(p_run uuid,p_fence text,p_lease_until timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.processing_runs set record=jsonb_set(record,'{leaseUntil}',to_jsonb(p_lease_until)) where id=p_run and record->>'fence'=p_fence and not (record->>'cancelRequested')::boolean and record->>'stage' not in ('ready','source_ready','partial','failed','cancelled','waiting_quota');
 return found;
end $$;

create or replace function public.fieldops_delete_document(p_owner uuid,p_document uuid,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents; c public.comparisons; q jsonb; s jsonb; g jsonb; groups jsonb='[]'; members jsonb; begin
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 select * into c from public.comparisons where id=d.comparison_id and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if c.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 select value into q from jsonb_array_elements(c.snapshot->'quotations') where value->>'documentId'=p_document::text;
 s=jsonb_set(c.snapshot,'{quotations}',coalesce((select jsonb_agg(value) from jsonb_array_elements(c.snapshot->'quotations') where value->>'documentId'<>p_document::text),'[]'));
 s=jsonb_set(s,'{corrections}',coalesce((select jsonb_agg(value) from jsonb_array_elements(s->'corrections') where value->>'quotationId'<>coalesce(q->>'id',p_document::text)),'[]'));
 for g in select value from jsonb_array_elements(s->'groups') loop
  members=coalesce((select jsonb_agg(value) from jsonb_array_elements(g->'members') where value->>'quotationId'<>coalesce(q->>'id',p_document::text)),'[]');
  if jsonb_array_length(members)>0 then
   if members<>g->'members' then
    g=jsonb_set(g,'{members}',members)||'{"status":"stale","approvedRevision":null}'::jsonb;
    g=jsonb_set(g,'{acceptedOrderQuantities}',(g->'acceptedOrderQuantities')-coalesce(q->>'id',p_document::text));
    g=jsonb_set(g,'{sourceIds}',coalesce((select jsonb_agg(value) from jsonb_array_elements(g->'sourceIds') where value#>>'{}' not in(select id from public.source_spans where document_id=p_document)),'[]'));
   end if;
   groups=groups||jsonb_build_array(g);
  end if;
 end loop;
 s=jsonb_set(s,'{groups}',groups);
 insert into public.deletion_outbox(owner_id,storage_path) values(p_owner,d.storage_path);
 delete from public.documents where id=p_document;
 delete from public.corrections where comparison_id=c.id and record->>'quotationId'=coalesce(q->>'id',p_document::text);
 -- Prior snapshots can contain deleted quotation text, so remove them when a source is erased.
 delete from public.comparison_versions where comparison_id=c.id;
 perform public.fieldops_save_comparison(p_owner,s,c.revision);
end $$;

-- This is a server-only SQL backend. No browser/Data API role has application access.
-- Runtime login is provisioned separately and granted fieldops_server; it never owns tables.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='fieldops_server') then
  create role fieldops_server nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
end $$;
revoke create on schema public from public;
grant usage on schema public,neon_auth to fieldops_server;
-- Session checks need identity and expiry only, never stored OAuth/session tokens or passwords.
grant select(id,name,email,image,banned,"banExpires") on neon_auth."user" to fieldops_server;
grant select(id,"userId","providerId","accountId") on neon_auth.account to fieldops_server;
grant select(id,"userId","expiresAt") on neon_auth.session to fieldops_server;
create or replace function public.fieldops_invited(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from neon_auth.account a join neon_auth."user" u on u.id=a."userId" join public.invited_accounts i on i.github_user_id=a."accountId"
 where a."userId"=p_owner and a."providerId"='github' and i.active and not(coalesce(u.banned,false) and (u."banExpires" is null or u."banExpires">now())));
$$;
do $$ declare t text; f record; begin
 foreach t in array array['invited_accounts','workspaces','comparisons','documents','processing_runs','parsed_documents','extraction_versions','source_spans','quotation_items','corrections','match_groups','comparison_versions','deletion_outbox','processing_budget','processing_reservations','ai_checkpoints'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public',t);
  execute format('grant select on public.%I to fieldops_server',t);
  -- All runtime reads are backend-only. User-facing queries also bind an authenticated owner.
  execute format('create policy fieldops_server_read on public.%I for select to fieldops_server using(true)',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fieldops_%' loop
  execute format('revoke all on function %s from public',f.signature);
  execute format('grant execute on function %s to fieldops_server',f.signature);
 end loop;
end $$;
-- Internal helpers must only run inside the approved security-definer entry points.
revoke execute on function public.fieldops_snapshot(uuid,jsonb),public.fieldops_reserve_job() from fieldops_server;
grant delete on public.deletion_outbox to fieldops_server;
-- Keep tombstones through the maximum staging-ticket lifetime (300s) plus a 60s margin.
-- A later successful sweep deletes objects again before removing this row.
create policy fieldops_server_cleanup on public.deletion_outbox for delete to fieldops_server using(created_at<=now()-interval '6 minutes');
