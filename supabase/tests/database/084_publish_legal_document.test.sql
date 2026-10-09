begin;
select plan(45);

\ir status_fixture.inc

\set summary 'Adds retention periods for application data.'
\set request '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11'

select set_config('request.headers', json_build_object('x-request-id', :'request')::text, true);

-- AC11: 40 candidates, 10 employers and one user whose account kind is not committed, on top of the fixture
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000e' || lpad(n::text, 4, '0'))::uuid, 'legal' || n || '@example.test', now(),
       jsonb_build_object('intended_account_kind', case when n <= 40 then 'worker' else 'company' end)
from generate_series(1, 51) n;
update public.profiles set account_kind = intended_account_kind
where id::text like '00000000-0000-0000-0000-0000000e%' and right(id::text, 4)::int <= 50;

insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('privacy-policy', 1, 'Privacy policy', 'Version one.', 'The first approved text.', now() - interval '60 days'),
  ('privacy-policy', 2, 'Privacy policy', 'Version two.', 'The second approved text.', now() - interval '30 days');

create function pg_temp.publish_as(
  p_user uuid, p_slug text, p_title text, p_body text, p_summary text, p_aal text default 'aal2'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated', format('select public.publish_legal_document(%L, %L, %L, %L)', p_slug, p_title, p_body, p_summary), p_aal)
$$;
-- The job of account-ops for the last version of a slug: the pages of the fan-out until none is left, as 'pages|emails'.
create function pg_temp.fan_out(p_slug text, p_limit integer default 1000) returns text
language plpgsql as $$
declare
  v_version integer := (select max(version) from public.legal_documents where slug = p_slug);
  v_after uuid;
  v_row record;
  v_pages integer := 0;
  v_queued integer := 0;
begin
  loop
    select * into v_row from public.account_ops_fan_out_legal_version(p_slug, v_version, v_after, p_limit);
    exit when not found;
    v_pages := v_pages + 1;
    v_queued := v_queued + v_row.queued;
    v_after := v_row.last_id;
  end loop;
  return v_pages || '|' || v_queued;
end;
$$;
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.legal_documents) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from public.notifications)
$$;
create function pg_temp.recipients(p_slug text) returns bigint
language sql as $$ select count(*) from public.notifications where kind = 'legal_version' and payload ->> 'document_slug' = p_slug $$;

-- Who accepted what: all 51 users the privacy policy and the terms of service (the one whose kind is not committed
-- and the suspended user too), the 40 candidates the worker terms, the 10 employers the employer terms. Nobody accepted
-- the cookie policy.
insert into public.consents (user_id, purpose, version, action)
select p.id, s.slug, (select max(l.version) from public.legal_documents l where l.slug = s.slug), 'granted'
from public.profiles p
join (values ('privacy-policy', null), ('terms-of-service', null), ('worker-terms', 'worker'), ('employer-terms', 'company')) s (slug, kind)
  on s.kind is null or s.kind = p.account_kind::text
where p.id::text like '00000000-0000-0000-0000-0000000e%' or p.id = :'wsus';
select count(*) as examined from public.profiles where account_kind is not null and status = 'active' and deleted_at is null \gset

select is(
  pg_temp.publish_as(:'st_admin', 'privacy-policy', 'Privacy policy', repeat('x', 3000), :'summary'), 'ok',
  'AC11: the Platform Administrator publishes the privacy policy'
);
select is(
  (select format('%s|%s|%s', version, length(body), change_summary) from public.legal_documents where slug = 'privacy-policy' and version = 3),
  format('3|3000|%s', :'summary'), 'AC11: it is version 3, with its body and change summary'
);
select is((select published_at = now() from public.legal_documents where slug = 'privacy-policy' and version = 3), true, 'AC11: published now');
select is(
  (select string_agg(version || ':' || body, ',' order by version) from public.legal_documents where slug = 'privacy-policy' and version between 1 and 2),
  '1:Version one.,2:Version two.', 'AC11: versions 1 and 2 are unchanged'
);
select is(
  (select format('%s|%s|%s|%s', count(*), min(actor_id::text), min(metadata ->> 'reason'), min(metadata ->> 'request_id'))
   from audit.log where action = 'legal_document.publish' and entity_type = 'legal_document' and entity_id = 'privacy-policy:3'),
  format('1|%s|%s|%s', :'st_admin', :'summary', :'request'), 'AC11: one audit row records the slug, the version and the summary as the reason'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version'), 0::bigint,
  'AC11: the publication itself sends no email, so it does not wait for the users'
);
select is(
  (select count(*) from pgmq.q_account_ops
   where message @> jsonb_build_object('action', 'fan_out_legal_version', 'document_slug', 'privacy-policy', 'version', 3)),
  1::bigint, 'AC11: it queues one fan-out job for account-ops'
);
select is(pg_temp.fan_out('privacy-policy'), '1|50', 'AC11: the fan-out job queues the emails');
select is(
  pg_temp.recipients('privacy-policy'), 50::bigint,
  'AC11: the 40 candidates and the 10 employers who accepted it get a legal_version email'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and user_id = '00000000-0000-0000-0000-0000000e0051'), 0::bigint,
  'AC11: the user without a committed account kind gets none'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and user_id = :'wsus'), 0::bigint,
  'a suspended user gets none'
);
select is(
  (select format('%s|%s|%s', min(payload ->> 'document_slug'), min(payload ->> 'version'), min(payload ->> 'change_summary'))
   from public.notifications where kind = 'legal_version' and payload ->> 'document_slug' = 'privacy-policy'),
  format('privacy-policy|3|%s', :'summary'), 'AC11: each email carries the slug, the version and the change summary'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and status = 'queued'), 50::bigint,
  'AC11: the emails are queued'
);

select pg_temp.publish_as(:'st_admin', 'terms-of-service', 'Terms of service', 'The text.', :'summary') as terms \gset
select pg_temp.publish_as(:'st_admin', 'worker-terms', 'Worker terms', 'The text.', :'summary') as worker \gset
select pg_temp.publish_as(:'st_admin', 'employer-terms', 'Employer terms', 'The text.', :'summary') as employer \gset
select pg_temp.publish_as(:'st_admin', 'cookie-policy', 'Cookie policy', 'The text.', :'summary') as cookie \gset
select pg_temp.publish_as(:'st_admin', 'age-18-plus', 'Age attestation', 'The text.', :'summary') as age \gset
select pg_temp.fan_out('terms-of-service', 7) as pages_terms \gset
select pg_temp.fan_out('worker-terms') as pages_worker \gset
select pg_temp.fan_out('employer-terms') as pages_employer \gset
select pg_temp.fan_out('cookie-policy') as pages_cookie \gset
select pg_temp.fan_out('age-18-plus') as pages_age \gset
select is(:'terms' || :'worker' || :'employer' || :'cookie' || :'age', 'okokokokok', 'AC11: the other four slugs and the age attestation are published');
select is(
  :'pages_terms', ceil(:examined / 7.0)::integer || '|50',
  'AC11: with pages of 7 users the fan-out takes several pages and reaches everyone once'
);
select is(
  pg_temp.fan_out('terms-of-service', 7), ceil(:examined / 7.0)::integer || '|0',
  'AC11: a job that runs again walks the pages and queues no second email'
);
select is(pg_temp.fan_out('terms-of-service', 500), '1|0', 'and so does a run with pages of another size');
select is(pg_temp.recipients('terms-of-service'), 50::bigint, 'AC11: the terms of service reach the 50 who accepted them');
select is(pg_temp.recipients('worker-terms'), 40::bigint, 'AC11: the worker terms reach the candidates');
select is(pg_temp.recipients('employer-terms'), 10::bigint, 'AC11: the employer terms reach the employers');
select is(pg_temp.recipients('cookie-policy') || ',' || :'pages_cookie', '0,0|0', 'AC11: the cookie policy needs no acceptance, so nobody is told');
select is(pg_temp.recipients('age-18-plus') || ',' || :'pages_age', '0,0|0', 'the age attestation is never asked again');
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and user_id = :'wsus')
  + (select count(*) from public.notifications where kind = 'legal_version' and user_id = '00000000-0000-0000-0000-0000000e0051'),
  0::bigint, 'a suspended user and a user without a committed account kind are skipped on every page'
);
select is(
  (select version from public.legal_documents where slug = 'cookie-policy' order by version desc limit 1), 1,
  'a slug that holds only the draft version 0 continues with 1'
);
select pg_temp.publish_as(:'st_admin', 'brand-new-slug', 'A new document', 'The text.', :'summary') as fresh \gset
select is((select min(version) from public.legal_documents where slug = 'brand-new-slug'), 1, 'AC11: a new slug starts at version 1');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated'), ('service_role')) r (role_name)
   cross join (values ('insert'), ('update'), ('delete')) p (privilege)
   where n.nspname = 'public' and c.relname = 'legal_documents' and has_table_privilege(r.role_name, c.oid, p.privilege)),
  0::bigint, 'AC11: no API role has INSERT, UPDATE or DELETE on legal_documents'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values ('privacy-policy', 3, 'Again', 'Body.', 'Not a second version 3.', now())$$,
  '23505', null, 'AC11: a second row with the same slug and version is refused by the unique constraint'
);

-- A second submit of the same form (a retry, another tab) repeats the current version word for word: it is refused
select pg_temp.writes() as before_conflict \gset
select is(
  pg_temp.publish_as(:'st_admin', 'privacy-policy', 'Privacy policy', repeat('x', 3000), :'summary'), 'P0001|CHARA_CONFLICT|unchanged',
  'a repeat of the current version, word for word, is refused'
);
select is(pg_temp.writes(), :'before_conflict', 'the repeat creates no version, no audit row and no email');
select is(
  pg_temp.publish_as(:'st_admin', 'brand-new-slug', 'A new document', 'The text.', :'summary'), 'P0001|CHARA_CONFLICT|unchanged',
  'and so is a repeat of the first version of a new name'
);

-- the job of account-ops leaves its trace on the document, and only account-ops may run the fan-out
select msg_id as fan_job from pgmq.q_account_ops
where message @> jsonb_build_object('action', 'fan_out_legal_version', 'document_slug', 'privacy-policy', 'version', 3) \gset
select is(
  (select public.account_ops_ack(:fan_job, '{"emails": 5}')), true, 'the fan-out job is acknowledged'
);
select is(
  (select format('%s|%s|%s', entity_type, entity_id, metadata ->> 'action') from audit.log where action = 'account_ops_done' and metadata ->> 'msg_id' = :'fan_job'),
  'legal_document|privacy-policy:3|fan_out_legal_version', 'and its audit row names the version of the document'
);
select is(
  (select string_agg(r.role_name, ',' order by r.role_name) from (values ('anon'), ('authenticated'), ('service_role')) r (role_name)
   where has_function_privilege(r.role_name, 'public.account_ops_fan_out_legal_version(text, integer, uuid, integer)', 'execute')),
  'service_role', 'only the service role runs the fan-out'
);

-- AC11: refusals create nothing
select pg_temp.writes() as before \gset
select is(pg_temp.publish_as(:'st_admin', 'Bad_Slug', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC11: a slug with a capital or an underscore is refused');
select is(pg_temp.publish_as(:'st_admin', 'ab', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC11: and one of 2 characters');
select is(pg_temp.publish_as(:'st_admin', repeat('a', 61), 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC11: and one of 61');
select is(pg_temp.publish_as(:'st_admin', 'double--dash', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'a slug the table would refuse is refused first');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', '', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|title', 'AC11: an empty title is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', repeat('t', 201), 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|title', 'AC11: and one of 201 characters');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', '   ', :'summary'), 'P0001|CHARA_INVALID_INPUT|body', 'AC11: an empty body is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', repeat('b', 200001), :'summary'), 'P0001|CHARA_INVALID_INPUT|body', 'and one of 200001 characters');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', 'Body.', 'Too short'), 'P0001|CHARA_INVALID_INPUT|change_summary', 'AC11: a change summary of 9 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', 'Body.', repeat('s', 1001)), 'P0001|CHARA_INVALID_INPUT|change_summary', 'AC11: and one of 1001');
select is(pg_temp.writes(), :'before', 'AC11: a refused call creates no row, no audit row and no notification');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', repeat('t', 200), repeat('b', 200000), repeat('s', 1000)), 'ok', 'the limits themselves are accepted');

select * from finish();
rollback;
