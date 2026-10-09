-- FR-F3 AC8 (database side): the audit search of the console lists no event of a candidate document or share, so the
-- console shows no list and no count of documents. The rows stay in audit.log for the monthly export.
begin;
select plan(12);

\ir privacy_fixture.inc

select set_config('t.slg', :'slg', true);

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.found(p_args text) returns text
language sql as $$ select pg_temp.val_as(current_setting('t.slg')::uuid, 'aal2', format('select count(*) from public.admin_search_audit(%s, p_limit => 100)', p_args)) $$;

select pg_temp.doc(:'d1', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);
update public.worker_documents set title = 'Renamed' where id = :'d1';

select is(
  (select count(*) from audit.log where entity_type = 'worker_documents' and entity_id = :'d1'), 2::bigint,
  'setup: the document wrote its created and renamed events to the audit log'
);
select cmp_ok((select count(*) from audit.log where entity_type = 'passport_shares'), '>=', 1::bigint, 'setup: and the share wrote its event');
select is(
  (select value from private.settings where key = 'admin_audit_hidden_entity_types'), '["worker_documents", "passport_shares"]'::jsonb,
  'the entity types that the search hides are a setting'
);

select cmp_ok(pg_temp.found('p_entity_type => ''platform_staff'''), '>=', '3', 'the search still lists the events of other entity types');
select is(pg_temp.found('p_entity_type => ''worker_documents'''), '0', 'a search by the entity type of documents finds nothing');
select is(pg_temp.found('p_entity_type => ''passport_shares'''), '0', 'a search by the entity type of shares finds nothing');
select is(pg_temp.found(format('p_action => ''document.created'', p_entity_id => %L', :'d1')), '0', 'a search by the action and the id of the document finds nothing');
select is(pg_temp.found('p_action => ''share.created'''), '0', 'a search by the action of a share finds nothing');
select is(
  pg_temp.val_as(:'slg', 'aal2', $$select count(*) from public.admin_search_audit(p_limit => 100) where entity_type in ('worker_documents', 'passport_shares')$$),
  '0', 'an unfiltered page holds no event of documents or shares'
);

create temp table recorded as
select distinct m.g[1] as action, m.g[2] as entity_type
from pg_proc p
cross join lateral regexp_matches(p.prosrc, 'audit\.record\(\s*''((?:document|share)\.[a-z_]+)''\s*,\s*''([a-z_]+)''', 'g') m (g)
where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace);

select cmp_ok((select count(*) from recorded), '>=', 7::bigint, 'the scan of the function sources finds the seven document and share events written so far');
select is_empty(
  $$select action, entity_type from recorded
    where entity_type <> all (array(select jsonb_array_elements_text(value) from private.settings where key = 'admin_audit_hidden_entity_types'))$$,
  'every document or share event that a function writes has its entity type in the hidden setting, so a new one fails here until it is added'
);

update private.settings set value = '[]' where key = 'admin_audit_hidden_entity_types';
select is(
  pg_temp.found('p_entity_type => ''worker_documents'''), '2',
  'with the setting emptied the same search finds the two events, so the zeros above are the filter'
);

select * from finish();
rollback;
