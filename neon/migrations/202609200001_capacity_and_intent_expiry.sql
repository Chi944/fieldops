-- Additive migration: apply after 202609180001, inside one owner transaction.
-- These are conservative FieldOps pilot limits, not a guarantee about provider billing
-- or database size. Original bytes exclude derived JSON, indexes and provider backups.
-- Upload intents reserve capacity immediately. Deleted files retain their reservation
-- until a successful object cleanup after the existing six-minute signed-ticket grace.
alter table public.deletion_outbox add column size_bytes bigint not null default 20971520 check(size_bytes>0);
-- A pre-migration orphan has no surviving size metadata: reserve the full file limit.
update public.deletion_outbox o set size_bytes=(d.record->>'size')::bigint
 from public.documents d where d.storage_path=o.storage_path;
-- Consolidate any old duplicate tombstones without shortening their replay protection.
with bounds as (select storage_path,max(created_at) as created_at,max(size_bytes) as size_bytes from public.deletion_outbox group by storage_path)
 update public.deletion_outbox o set created_at=b.created_at,size_bytes=b.size_bytes from bounds b where b.storage_path=o.storage_path;
delete from public.deletion_outbox a using public.deletion_outbox b where a.storage_path=b.storage_path and a.id>b.id;
create unique index deletion_outbox_object on public.deletion_outbox(storage_path);
create index documents_upload_expiry on public.documents(created_at) where record->>'status'='uploading' and deleted_at is null;
-- These redundant owner FKs previously blocked a managed-user deletion before the
-- document cascade could remove parsed/item rows. Both contain only derived owner data.
alter table public.parsed_documents drop constraint parsed_documents_owner_id_fkey;
alter table public.parsed_documents add constraint parsed_documents_owner_id_fkey foreign key(owner_id) references neon_auth."user"(id) on delete cascade;
alter table public.quotation_items drop constraint quotation_items_owner_id_fkey;
alter table public.quotation_items add constraint quotation_items_owner_id_fkey foreign key(owner_id) references neon_auth."user"(id) on delete cascade;

-- Covers explicit source/comparison deletion and cascading workspace/account deletion.
-- The tombstone starts at deletion, NOT at the intent's potentially old creation time.
create function public.fieldops_enqueue_deleted_document() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.deletion_outbox(owner_id,storage_path,size_bytes)
 values(old.owner_id,old.storage_path,(old.record->>'size')::bigint)
 on conflict(storage_path) do update set
  size_bytes=greatest(public.deletion_outbox.size_bytes,excluded.size_bytes),
  created_at=greatest(public.deletion_outbox.created_at,excluded.created_at);
 return old;
end $$;
create trigger fieldops_document_cleanup before delete on public.documents
 for each row execute function public.fieldops_enqueue_deleted_document();

-- The runtime is server-only. User-facing status must omit other owners' project counts;
-- the full aggregate is used for admission and operator diagnostics only.
create function public.fieldops_capacity(p_owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with reservations as (
  select owner_id,storage_path,max(size_bytes) as size_bytes,bool_or(pending) as pending
  from (
   select owner_id,storage_path,(record->>'size')::bigint as size_bytes,false as pending from public.documents
   union all select owner_id,storage_path,size_bytes,true from public.deletion_outbox
  ) r group by owner_id,storage_path
 ), usage as (
  select count(*) as documents,coalesce(sum(size_bytes),0) as bytes,
   count(*) filter(where pending) as pending_documents,coalesce(sum(size_bytes) filter(where pending),0) as pending_bytes,
   count(*) filter(where owner_id=p_owner) as owner_documents,coalesce(sum(size_bytes) filter(where owner_id=p_owner),0) as owner_bytes,
   count(*) filter(where pending and owner_id=p_owner) as owner_pending_documents,
   coalesce(sum(size_bytes) filter(where pending and owner_id=p_owner),0) as owner_pending_bytes from reservations
 ), comparisons as (
  select count(*) as comparisons,count(*) filter(where owner_id=p_owner) as owner_comparisons from public.comparisons where deleted_at is null
 ) select jsonb_build_object(
  'workspace',jsonb_build_object('comparisons',c.owner_comparisons,'documents',u.owner_documents,'bytes',u.owner_bytes,
   'pendingDeletionDocuments',u.owner_pending_documents,'pendingDeletionBytes',u.owner_pending_bytes,
   'limits',jsonb_build_object('comparisons',20,'documents',50,'bytes',104857600)),
  'project',jsonb_build_object('comparisons',c.comparisons,'documents',u.documents,'bytes',u.bytes,
   'pendingDeletionDocuments',u.pending_documents,'pendingDeletionBytes',u.pending_bytes,
   'limits',jsonb_build_object('comparisons',100,'documents',200,'bytes',262144000)),
  'uploadIntentTtlHours',24) from usage u cross join comparisons c;
$$;

create or replace function public.fieldops_create_comparison(p_owner uuid,p_snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
declare capacity jsonb; begin
 -- All capacity-increasing operations use this lock before any comparison row lock.
 perform pg_advisory_xact_lock(hashtext('fieldops-storage-capacity'));
 capacity=public.fieldops_capacity(p_owner);
 if (capacity#>>'{workspace,comparisons}')::bigint>=20 then raise exception 'workspace_comparison_limit'; end if;
 if (capacity#>>'{project,comparisons}')::bigint>=100 then raise exception 'project_capacity'; end if;
 insert into public.workspaces(id,owner_id) values(p_owner,p_owner) on conflict(id) do nothing;
 insert into public.comparisons(id,workspace_id,owner_id,revision,snapshot) values((p_snapshot->>'id')::uuid,p_owner,p_owner,(p_snapshot->>'revision')::int,p_snapshot);
 perform public.fieldops_snapshot(p_owner,p_snapshot);
end $$;

create or replace function public.fieldops_create_upload(p_owner uuid,p_document jsonb,p_run jsonb,p_quotation jsonb,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.comparisons; s jsonb; selected_mode text; capacity jsonb; bytes bigint; begin
 if not coalesce((p_document->>'size')~'^[0-9]{1,8}$',false) then raise exception 'file_size'; end if;
 bytes=(p_document->>'size')::bigint;
 if bytes<1 or bytes>20971520 then raise exception 'file_size'; end if;
 selected_mode=coalesce(p_document->>'processingMode','parse_only');
 if selected_mode not in ('parse_only','ai') then raise exception 'invalid_processing_mode'; end if;
 p_document=p_document||jsonb_build_object('processingMode',selected_mode);
 if p_run is not null then
  if coalesce(p_run->>'processingMode','parse_only')<>selected_mode then raise exception 'processing_mode_mismatch'; end if;
  p_run=p_run||jsonb_build_object('processingMode',selected_mode);
 end if;
 perform pg_advisory_xact_lock(hashtext('fieldops-storage-capacity'));
 select * into c from public.comparisons where id=(p_document->>'comparisonId')::uuid and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if c.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 if jsonb_array_length(c.snapshot->'quotations')>=5 then raise exception 'comparison_document_limit'; end if;
 capacity=public.fieldops_capacity(p_owner);
 if (capacity#>>'{workspace,documents}')::bigint>=50 then raise exception 'workspace_document_limit'; end if;
 if (capacity#>>'{workspace,bytes}')::bigint+bytes>104857600 then raise exception 'workspace_storage_limit'; end if;
 if (capacity#>>'{project,documents}')::bigint>=200 or (capacity#>>'{project,bytes}')::bigint+bytes>262144000 then raise exception 'project_capacity'; end if;
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
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null;
 if not found then raise exception 'not_found'; end if;
 -- Comparison then document matches deletion/expiry lock order, including FK inserts.
 perform 1 from public.comparisons where id=d.comparison_id and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if d.record->>'status'<>'uploading' then return; end if;
 -- Rejected finalization leaves the tracked intent intact for the durable expiry sweep.
 if d.created_at<=now()-interval '24 hours' then raise exception 'upload_expired'; end if;
 if coalesce(p_run->>'processingMode','parse_only')<>coalesce(d.record->>'processingMode','parse_only') then raise exception 'processing_mode_mismatch'; end if;
 p_run=p_run||jsonb_build_object('processingMode',coalesce(d.record->>'processingMode','parse_only'));
 perform public.fieldops_reserve_job();
 update public.documents set content_hash=p_hash,record=jsonb_set(jsonb_set(record,'{status}','"uploaded"'),'{contentHash}',to_jsonb(p_hash)) where id=p_document;
 insert into public.processing_runs(id,document_id,comparison_id,owner_id,record) values((p_run->>'id')::uuid,p_document,d.comparison_id,p_owner,p_run);
end $$;

create or replace function public.fieldops_delete_comparison(p_owner uuid,p_comparison uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.comparisons where id=p_comparison and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 -- Document delete triggers durably enqueue every object before the cascade completes.
 delete from public.comparisons where id=p_comparison and owner_id=p_owner;
end $$;

create or replace function public.fieldops_delete_document(p_owner uuid,p_document uuid,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents; c public.comparisons; q jsonb; s jsonb; g jsonb; groups jsonb='[]'; members jsonb; begin
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null;
 if not found then raise exception 'not_found'; end if;
 select * into c from public.comparisons where id=d.comparison_id and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
 if c.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 select * into d from public.documents where id=p_document and owner_id=p_owner and deleted_at is null for update;
 if not found then raise exception 'not_found'; end if;
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
 delete from public.documents where id=p_document;
 delete from public.corrections where comparison_id=c.id and record->>'quotationId'=coalesce(q->>'id',p_document::text);
 delete from public.comparison_versions where comparison_id=c.id;
 perform public.fieldops_save_comparison(p_owner,s,c.revision);
end $$;

-- Maintenance is bounded. Lock comparisons before documents and skip active work;
-- recheck the intent after obtaining locks so a completed upload can never be expired.
create function public.fieldops_expire_uploads() returns integer language plpgsql security definer set search_path='' as $$
declare candidate_ids uuid[]; candidate_id uuid; d public.documents; revision integer; expired integer=0; begin
 -- Materialize before editing a comparison: a locking cursor over that same row can
 -- otherwise skip later sibling intents after our own revision update.
 select array_agg(candidate.id) into candidate_ids from (
  select intent.id from public.documents intent
   join public.comparisons c on c.id=intent.comparison_id and c.owner_id=intent.owner_id
  where intent.record->>'status'='uploading' and intent.created_at<=now()-interval '24 hours'
   and intent.deleted_at is null and c.deleted_at is null
  order by intent.created_at,intent.id limit 25 for update of c skip locked
 ) candidate;
 foreach candidate_id in array coalesce(candidate_ids,'{}'::uuid[]) loop
  select * into d from public.documents where id=candidate_id
   and deleted_at is null and record->>'status'='uploading' and created_at<=now()-interval '24 hours' for update skip locked;
  if not found then continue; end if;
  select c.revision into revision from public.comparisons c where c.id=d.comparison_id and c.owner_id=d.owner_id;
  perform public.fieldops_delete_document(d.owner_id,d.id,revision);
  expired=expired+1;
 end loop;
 return expired;
end $$;

revoke all on function public.fieldops_enqueue_deleted_document(),public.fieldops_capacity(uuid),public.fieldops_expire_uploads() from public;
grant execute on function public.fieldops_capacity(uuid),public.fieldops_expire_uploads() to fieldops_server;
-- The trigger helper is never an application entry point. Existing replaced functions
-- retain their prior explicit grants. RLS and the six-minute outbox DELETE policy remain.
revoke all on function public.fieldops_enqueue_deleted_document() from fieldops_server;
