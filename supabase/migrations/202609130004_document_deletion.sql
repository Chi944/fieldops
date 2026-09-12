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
revoke all on function public.fieldops_delete_document(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.fieldops_delete_document(uuid,uuid,integer) to service_role;
