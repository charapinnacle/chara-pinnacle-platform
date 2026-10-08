begin;
select plan(34);

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

create function pg_temp.publish_as(p_user uuid, p_slug text, p_title text, p_body text, p_summary text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.publish_legal_document(%L, %L, %L, %L)', p_slug, p_title, p_body, p_summary), p_aal)
$$;
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.legal_documents) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_notifications) || ',' || (select count(*) from public.notifications)
$$;
create function pg_temp.recipients(p_slug text) returns bigint
language sql as $$ select count(*) from public.notifications where kind = 'legal_version' and payload ->> 'document_slug' = p_slug $$;

select count(*) filter (where account_kind = 'worker' and status = 'active') as workers,
       count(*) filter (where account_kind = 'company' and status = 'active') as companies
from public.profiles \gset

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
  pg_temp.recipients('privacy-policy'), (:workers + :companies)::bigint,
  'AC11: every active user with a committed account kind gets a legal_version email'
);
select is(:workers, 40 + (select count(*) from public.profiles where account_kind = 'worker' and status = 'active' and id::text not like '00000000-0000-0000-0000-0000000e%')::int, 'the candidates are the 40 and the fixture');
select is(:companies, 10 + (select count(*) from public.profiles where account_kind = 'company' and status = 'active' and id::text not like '00000000-0000-0000-0000-0000000e%')::int, 'the employers are the 10 and the fixture');
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
  (select count(*) from public.notifications where kind = 'legal_version' and status = 'queued'), (:workers + :companies)::bigint,
  'AC11: the emails are queued'
);

select pg_temp.publish_as(:'st_admin', 'terms-of-service', 'Terms of service', 'The text.', :'summary') as terms \gset
select pg_temp.publish_as(:'st_admin', 'worker-terms', 'Worker terms', 'The text.', :'summary') as worker \gset
select pg_temp.publish_as(:'st_admin', 'employer-terms', 'Employer terms', 'The text.', :'summary') as employer \gset
select pg_temp.publish_as(:'st_admin', 'cookie-policy', 'Cookie policy', 'The text.', :'summary') as cookie \gset
select pg_temp.publish_as(:'st_admin', 'age-18-plus', 'Age attestation', 'The text.', :'summary') as age \gset
select is(:'terms' || :'worker' || :'employer' || :'cookie' || :'age', 'okokokokok', 'AC11: the other four slugs and the age attestation are published');
select is(pg_temp.recipients('terms-of-service'), (:workers + :companies)::bigint, 'AC11: the terms of service reach everyone');
select is(pg_temp.recipients('worker-terms'), :workers::bigint, 'AC11: the worker terms reach the candidates');
select is(pg_temp.recipients('employer-terms'), :companies::bigint, 'AC11: the employer terms reach the employers');
select is(pg_temp.recipients('cookie-policy'), 0::bigint, 'AC11: the cookie policy needs no acceptance, so nobody is told');
select is(pg_temp.recipients('age-18-plus'), 0::bigint, 'the age attestation is never asked again');
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
