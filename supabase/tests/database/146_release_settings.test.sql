begin;
select plan(19);

\ir status_fixture.inc

-- The release switches of releases 2a to 2c (V25, FR-L5 AC2, SOP FR-L5 step Switch on and control "menu items tied to
-- released features"; NFR-O5). Read by everyone through get_public_settings, changed only through the settings editor
-- of FR-R2 by a Platform Administrator at aal2, audited, and refused on while a legal document of the release is a draft.

\set reason 'Go live with release 2b now'

create function pg_temp.admin(p_sql text, p_user uuid default '00000000-0000-0000-0000-00000000a021', p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal) $$;

create function pg_temp.settings_state() returns text
language sql as $$
  select (select count(*) from audit.log) || '|' || (select md5(string_agg(key || value::text, ',' order by key)) from private.settings)
$$;

select is(
  (select string_agg(key || '=' || (value #>> '{}') || ':' || jsonb_typeof(value), ',' order by key) from private.settings
   where key like 'release\_%'),
  'release_candidate_submissions=false:boolean,release_corridors=false:boolean,release_data_export=false:boolean,'
  || 'release_find_workers=false:boolean,release_job_orders=false:boolean,release_messaging=false:boolean,'
  || 'release_partner_directories=false:boolean',
  'the seven release switches (the five releases of DATA_MODEL.md section 1, the data export of V29 and the workforce corridors) exist as jsonb booleans and are off by default'
);

set local role anon;
select is(
  (select string_agg(key || '=' || value, ',' order by key) from public.get_public_settings() where key like 'release\_%'),
  'release_candidate_submissions=false,release_corridors=false,release_data_export=false,release_find_workers=false,'
  || 'release_job_orders=false,release_messaging=false,release_partner_directories=false',
  'AC2: an anonymous caller reads every release switch and its boolean value through get_public_settings'
);
reset role;

select is(
  (select string_agg(key || ':' || value_type || ':' || coalesce(release_feature, 'none'), ',' order by key) from private.setting_rules
   where key like 'release\_%'),
  'release_candidate_submissions:boolean:job_orders,release_corridors:boolean:partner_accounts,release_data_export:boolean:none,'
  || 'release_find_workers:boolean:find_workers,release_job_orders:boolean:job_orders,release_messaging:boolean:find_workers,'
  || 'release_partner_directories:boolean:partner_accounts',
  'each release switch is a boolean of the settings editor with the legal release feature it puts live (as check-go-live maps them); the data export needs none, the corridors those of release 2a'
);
select is(
  (select count(*) from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_settings()$$, 'aal2')) x
   where x ->> 'key' like 'release\_%' and x ->> 'release_feature' is not null and x ->> 'value' = 'false'),
  6::bigint, 'the console lists the six release switches with legal documents among the releases, each with its state'
);
select is(
  (select x -> 'release_gaps' from jsonb_array_elements(pg_temp.json_as(:'st_admin', $$select * from public.admin_list_settings()$$, 'aal2')) x
   where x ->> 'key' = 'release_job_orders'),
  (select to_jsonb(array_agg(slug || ':' || state)) from private.legal_release_gaps('job_orders')),
  'the console names the legal documents that still stop release 2b'
);

-- AC2: who may change a switch ----------------------------------------------------------------------------------------
select pg_temp.settings_state() as before \gset
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$select public.admin_set_setting('release_job_orders', 'true', 'Go live with release 2b now')$$, 'aal2'),
  'P0001|CHARA_FORBIDDEN|', 'AC2: an authenticated user is refused with CHARA_FORBIDDEN'
);
select is(
  pg_temp.admin($$select public.admin_set_setting('release_job_orders', 'true', 'Go live with release 2b now')$$, :'st_trust'),
  'P0001|CHARA_FORBIDDEN|', 'AC2: a Trust & Safety Administrator is refused with CHARA_FORBIDDEN'
);
select is(
  pg_temp.admin($$select public.admin_set_setting('release_job_orders', 'true', 'Go live with release 2b now')$$, :'st_admin', 'aal1'),
  'P0001|CHARA_FORBIDDEN|aal2_required', 'a Platform Administrator at aal1 is sent to the second step'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.admin_set_setting('release_job_orders', 'true', 'Go live with release 2b now')$$),
  '42501|permission denied for function admin_set_setting|', 'an anonymous caller cannot call the editor'
);
select is(
  pg_temp.call_as(:'own1', 'authenticated', $$update private.settings set value = 'true' where key = 'release_job_orders'$$, 'aal2'),
  '42501|permission denied for table settings|', 'nobody writes a switch directly'
);
select is(pg_temp.settings_state(), :'before', 'the refused calls changed no setting and wrote no audit row');

-- The go-live gate of V16 applies to every new switch -----------------------------------------------------------------
select is(
  pg_temp.admin($$select public.admin_set_setting('release_find_workers', 'true', 'Go live with release 2c now')$$),
  'P0001|CHARA_FORBIDDEN|release_legal_gaps', 'release 2c is refused on while a legal document of find_workers is not approved'
);

select is(
  pg_temp.admin($$select public.admin_set_setting('release_job_orders', 'true', 'Go live with release 2b now')$$),
  'P0001|CHARA_FORBIDDEN|release_legal_gaps', 'release_job_orders is refused on while a legal document of job_orders is not approved'
);
select is(
  pg_temp.admin($$select public.admin_set_setting('release_candidate_submissions', 'true', 'Go live with release 2b now')$$),
  'P0001|CHARA_FORBIDDEN|release_legal_gaps', 'release_candidate_submissions is refused on while a legal document of job_orders is not approved'
);
select is(
  pg_temp.admin($$select public.admin_set_setting('release_messaging', 'true', 'Go live with release 2c now')$$),
  'P0001|CHARA_FORBIDDEN|release_legal_gaps', 'release_messaging is refused on while a legal document of find_workers is not approved'
);

insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft)
select g.slug, coalesce((select max(d.version) from public.legal_documents d where d.slug = g.slug), 0) + 1, 'Approved ' || g.slug,
  'The approved text.', 'Approved by legal counsel.', now() - interval '1 minute', false
from private.legal_release_gaps('job_orders') g;

-- AC2: the Platform Administrator succeeds, with one audit row ---------------------------------------------------------
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.admin(format('select public.admin_set_setting(%L, %L, %L)', 'release_job_orders', 'true', :'reason')),
  'ok', 'AC2: a Platform Administrator at aal2 switches release_job_orders on once its legal documents are approved'
);
select is(
  (select string_agg(format('%s|%s|%s|%s|%s', action, entity_id, metadata ->> 'before', metadata ->> 'after', metadata ->> 'reason'), ';')
   from audit.log where id > :base),
  'setting.changed|release_job_orders|false|true|' || :'reason', 'AC2: exactly one audit row holds the old and the new value and the reason'
);
set local role anon;
select is(
  (select value from public.get_public_settings() where key = 'release_job_orders'), 'true',
  'AC3, AC4: the next read of the public settings sees the switch on'
);
reset role;
select is(
  (select string_agg(key || '=' || (value #>> '{}'), ',' order by key) from private.settings
   where key in ('release_candidate_submissions', 'release_corridors', 'release_partner_directories')),
  'release_candidate_submissions=false,release_corridors=false,release_partner_directories=false', 'the other switches keep their own value'
);

select * from finish();
rollback;
