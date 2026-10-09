begin;
select plan(70);

\ir status_fixture.inc

\set summary 'Adds the retention periods of application data to the policy.'

create function pg_temp.publish_as(
  p_user uuid, p_slug text, p_title text, p_body text, p_summary text, p_draft boolean default false, p_aal text default 'aal2'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select public.publish_legal_document(%L, %L, %L, %L, %L)', p_slug, p_title, p_body, p_summary, p_draft), p_aal)
$$;
create function pg_temp.writes() returns text
language sql as $$
  select (select count(*) from public.legal_documents) || ',' || (select count(*) from audit.log) || ','
      || (select count(*) from pgmq.q_account_ops) || ',' || (select count(*) from public.notifications)
$$;
create function pg_temp.fan_out(p_slug text) returns integer
language plpgsql as $$
declare
  v_version integer := (select max(version) from public.legal_documents where slug = p_slug);
  v_after uuid;
  v_row record;
  v_queued integer := 0;
begin
  loop
    select * into v_row from public.account_ops_fan_out_legal_version(p_slug, v_version, v_after);
    exit when not found;
    v_queued := v_queued + v_row.queued;
    v_after := v_row.last_id;
  end loop;
  return v_queued;
end;
$$;
create function pg_temp.told(p_slug text) returns text
language sql as $$
  select coalesce(string_agg(n.user_id::text, ',' order by n.user_id), '') from public.notifications n
  where n.kind = 'legal_version' and n.payload ->> 'document_slug' = p_slug
$$;

-- FR-H3 AC2: the current-version view
insert into public.legal_documents (slug, version, title, body, change_summary, published_at, is_draft) values
  ('h3-terms', 1, 'Terms', 'Body one.', 'The first approved text.', now() - interval '40 days', false),
  ('h3-terms', 2, 'Terms', 'Body two.', 'The second approved text.', now() - interval '20 days', false),
  ('h3-terms', 3, 'Terms', E'## Scope\n\nBody three.', 'The third approved text.', now() - interval '1 day', true),
  ('h3-terms', 4, 'Terms', 'Body four.', 'Dated in the future.', now() + interval '1 day', false),
  ('h3-privacy', 1, 'Privacy', 'Body one.', 'The first approved text.', now() - interval '10 days', false);
insert into public.legal_documents (slug, version, title, body, change_summary)
values ('h3-unpublished', 1, 'Unpublished', 'Body.', 'Never published at all.');

set local role anon;
select results_eq(
  $$select slug, version from public.v_legal_current where slug like 'h3-%' order by slug$$,
  $$values ('h3-privacy'::text, 1), ('h3-terms'::text, 3)$$,
  'AC2: anon reads exactly one row per slug, the highest published version; a future or unpublished row does not count'
);
select is(
  (select format('%s|%s|%s|%s', body, change_summary, is_draft, published_at is not null) from public.v_legal_current where slug = 'h3-terms'),
  E'## Scope\n\nBody three.|The third approved text.|t|t', 'AC2: the row holds the body, the change summary and the draft mark of that version'
);
select is_empty($$select 1 from public.v_legal_current where slug in ('h3-unpublished', 'no-such-document')$$, 'AC2: a slug with no published row returns nothing');
select is(
  (select count(*) from public.v_legal_current where slug = 'privacy-policy'), 1::bigint, 'the seeded placeholder is the current version of a document nobody published yet'
);
reset role;
select is(
  (select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_legal_current'::regclass), 'security_invoker=true',
  'the view runs with the rights of the caller'
);
select ok(
  has_table_privilege('anon', 'public.v_legal_current', 'select') and has_table_privilege('authenticated', 'public.v_legal_current', 'select')
  and not has_table_privilege('anon', 'public.v_legal_current', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.v_legal_current', 'insert, update, delete')
  and not has_table_privilege('service_role', 'public.v_legal_current', 'select'),
  'anon and authenticated read the view and nobody writes it'
);

-- FR-H3 AC4: publish
select set_config('request.headers', json_build_object('x-request-id', '7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11', 'x-forwarded-for', '203.0.113.7')::text, true);
select pg_temp.writes() as before_publish \gset
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.publish_legal_document('h3-privacy', 'Privacy policy', 'The new body.', %L, false)$$, repeat('c', 40))),
  '2', 'AC4: the Platform Administrator at aal2 publishes and receives version 2'
);
select is(
  (select format('%s|%s|%s|%s', title, body, is_draft, published_at = now()) from public.legal_documents where slug = 'h3-privacy' and version = 2),
  'Privacy policy|The new body.|f|t', 'AC4: version 2 holds the new text, is not a draft and was published at the transaction time'
);
select is(
  (select format('%s|%s|%s', title, body, change_summary) from public.legal_documents where slug = 'h3-privacy' and version = 1),
  'Privacy|Body one.|The first approved text.', 'AC4: version 1 is unchanged'
);
select is(
  (select count(*) from audit.log where action = 'legal_document.publish' and entity_id = 'h3-privacy:2'), 1::bigint, 'AC4: one audit row'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', actor_id, entity_type, metadata ->> 'slug', metadata ->> 'version', metadata ->> 'is_draft',
                 metadata ->> 'reason', ip)
   from audit.log where action = 'legal_document.publish' and entity_id = 'h3-privacy:2'),
  format('%s|legal_document|h3-privacy|2|false|%s|203.0.113.7', :'st_admin', repeat('c', 40)),
  'AC4: it names the actor, the slug, the version, the draft mark and the change summary'
);
select is(
  (select count(*) from pgmq.q_account_ops where message @> '{"action": "fan_out_legal_version", "document_slug": "h3-privacy", "version": 2}'),
  1::bigint, 'AC4: the job that queues the emails is queued in the same transaction'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', format($$select public.publish_legal_document('h3-privacy', 'Privacy policy', 'The new body.', %L, true)$$, :'summary')),
  '3', 'the approval of the same text is a new version, published as a draft here'
);
select is(
  (select format('%s|%s', is_draft, (select a.metadata ->> 'is_draft' from audit.log a where a.entity_id = 'h3-privacy:3' and a.action = 'legal_document.publish'))
   from public.legal_documents where slug = 'h3-privacy' and version = 3),
  't|true', 'a draft is stored as a draft and the audit row says so'
);
select is(
  (select count(*) from public.v_legal_current where slug = 'h3-privacy' and version = 3 and is_draft), 1::bigint, 'AC3: the view shows the draft mark of the current version'
);
select is(
  pg_temp.publish_as(:'st_admin', 'h3-privacy', 'Privacy policy', 'The new body.', :'summary', true), 'P0001|CHARA_CONFLICT|unchanged',
  'a repeat of the current version, word for word, is refused'
);
select is(
  pg_temp.publish_as(:'st_admin', 'h3-privacy', 'Privacy policy', 'The new body.', :'summary', false), 'ok',
  'the same text without the draft mark is the approval and a new version'
);
select is(
  pg_temp.publish_as(:'st_admin', 'h3-fresh', 'A new document', 'The first text.', :'summary'), 'ok', 'a new slug is published'
);
select is((select min(version) from public.legal_documents where slug = 'h3-fresh'), 1, 'a new slug starts at version 1');
select is(
  (select string_agg(version::text, ',' order by version) from public.legal_documents where slug = 'h3-privacy'), '1,2,3,4',
  'every publication is the next version of the slug and the versions have no gap'
);

-- FR-H3 AC5: validation
select pg_temp.writes() as before_refusals \gset
select is(pg_temp.publish_as(:'st_admin', repeat('a', 81), 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC5: a slug of 81 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'Capital', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC5: a slug with a capital is refused');
select is(pg_temp.publish_as(:'st_admin', 'has space', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC5: a slug with a space is refused');
select is(pg_temp.publish_as(:'st_admin', 'double--hyphen', 'Title', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|slug', 'AC5: a slug with a double hyphen is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Ti', 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|title', 'AC5: a title of 2 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', repeat('t', 201), 'Body.', :'summary'), 'P0001|CHARA_INVALID_INPUT|title', 'AC5: a title of 201 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', '', :'summary'), 'P0001|CHARA_INVALID_INPUT|body', 'AC5: an empty body is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', repeat('b', 200001), :'summary'), 'P0001|CHARA_INVALID_INPUT|body', 'AC5: a body of 200001 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', 'Body.', repeat('s', 9)), 'P0001|CHARA_INVALID_INPUT|change_summary', 'AC5: a change summary of 9 characters is refused');
select is(pg_temp.publish_as(:'st_admin', 'a-slug', 'Title', 'Body.', repeat('s', 1001)), 'P0001|CHARA_INVALID_INPUT|change_summary', 'AC5: a change summary of 1001 characters is refused');
select is(
  pg_temp.call_as(:'st_admin', 'authenticated', $$select public.publish_legal_document('a-slug', 'Title', 'Body.', 'A change summary.', null)$$),
  'P0001|CHARA_INVALID_INPUT|is_draft', 'a missing draft mark is refused'
);
select is(pg_temp.writes(), :'before_refusals', 'AC5: no row, no audit row, no job and no notification');

-- FR-H3 AC6: who may publish
select is(
  (select string_agg(split_part(pg_temp.publish_as(c.id, 'a-slug', 'Title', 'Body.', :'summary', false, c.aal), '|', 2), ',' order by c.n)
   from (values (1, :'wa'::uuid, 'aal2'), (2, :'own1'::uuid, 'aal2'), (3, :'st_trust'::uuid, 'aal2'), (4, :'st_review'::uuid, 'aal2'), (5, :'st_admin'::uuid, 'aal1')) c (n, id, aal)),
  'CHARA_FORBIDDEN,CHARA_FORBIDDEN,CHARA_FORBIDDEN,CHARA_FORBIDDEN,CHARA_FORBIDDEN',
  'AC6: a candidate, an organisation owner, a Trust & Safety Administrator, a Verification Reviewer and an administrator at aal1 are refused'
);
select is(
  pg_temp.call_as(null, 'anon', $$select public.publish_legal_document('a-slug', 'Title', 'Body.', 'A change summary.')$$),
  '42501|permission denied for function publish_legal_document|', 'AC6: the anonymous caller has no execute privilege'
);
select is(pg_temp.writes(), :'before_refusals', 'AC6: no row, no audit row, no job and no notification');

-- FR-H3 AC7: versions are immutable and there is one way to write them
select is(
  (select string_agg(split_part(pg_temp.call_as(r.id, r.role_name, $$update public.legal_documents set body = 'tampered' where slug = 'h3-terms' and version = 2$$, 'aal2'), '|', 1), ',' order by r.n)
   from (values (1, :'st_admin'::uuid, 'authenticated'), (2, :'wa'::uuid, 'authenticated'), (3, null::uuid, 'anon'), (4, null::uuid, 'service_role')) r (n, id, role_name)),
  '42501,42501,42501,42501', 'AC7: authenticated (the administrator included), anon and service_role cannot update a version'
);
select is(
  (select string_agg(split_part(pg_temp.call_as(r.id, r.role_name, $$delete from public.legal_documents where slug = 'h3-terms' and version = 2$$, 'aal2'), '|', 1), ',' order by r.n)
   from (values (1, :'st_admin'::uuid, 'authenticated'), (2, :'wa'::uuid, 'authenticated'), (3, null::uuid, 'anon'), (4, null::uuid, 'service_role')) r (n, id, role_name)),
  '42501,42501,42501,42501', 'AC7: and cannot delete one'
);
select is(
  (select string_agg(split_part(pg_temp.call_as(r.id, r.role_name,
     $$insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values ('h3-terms', 9, 'Forged', 'Body.', 'A forged version.', now())$$, 'aal2'), '|', 1), ',' order by r.n)
   from (values (1, :'st_admin'::uuid, 'authenticated'), (2, :'wa'::uuid, 'authenticated'), (3, null::uuid, 'anon'), (4, null::uuid, 'service_role')) r (n, id, role_name)),
  '42501,42501,42501,42501', 'AC7: and cannot insert one'
);
select is(
  (select format('%s|%s', body, count(*) over ()) from public.legal_documents where slug = 'h3-terms' and version = 2), 'Body two.|1', 'AC7: the version is unchanged'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values ('h3-terms', 2, 'Again', 'Body.', 'The same version again.', now())$$,
  '23505', null, 'AC7: a duplicate (slug, version) fails on the unique constraint'
);
select is(
  (select count(*) from (select slug, version from public.legal_documents group by 1, 2 having count(*) > 1) d), 0::bigint,
  'AC7: no slug and version pair exists twice'
);

-- FR-H3 AC10: who is told about a new version
select pg_temp.new_user(('00000000-0000-0000-0000-0000000f01' || lpad(n::text, 2, '0'))::uuid, case when n = 5 then 'company' else 'worker' end)
from generate_series(1, 8) n;
update public.profiles set account_kind = intended_account_kind where id::text like '00000000-0000-0000-0000-0000000f01%';
update public.profiles set deleted_at = now() where id = '00000000-0000-0000-0000-0000000f0106';
insert into public.notification_preferences (user_id, digest) values ('00000000-0000-0000-0000-0000000f0102', true);
insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('privacy-policy', 1, 'Privacy policy', 'Body one.', 'The first approved text.', now() - interval '30 days'),
  ('cookie-policy', 1, 'Cookie policy', 'Body one.', 'The first approved text.', now() - interval '30 days'),
  ('employer-terms', 1, 'Employer terms', 'Body one.', 'The first approved text.', now() - interval '30 days');
-- users 1 to 5 and the deleted user 6 accepted the privacy policy; user 7 never did; user 8 accepted it and withdrew;
-- user 5 is the employer owner and also accepted the employer terms
insert into public.consents (user_id, purpose, version, action)
select ('00000000-0000-0000-0000-0000000f01' || lpad(n::text, 2, '0'))::uuid, 'privacy-policy', 1, 'granted'::public.consent_action from generate_series(1, 6) n
union all select ('00000000-0000-0000-0000-0000000f0108')::uuid, 'privacy-policy', 1, 'granted'::public.consent_action
union all select ('00000000-0000-0000-0000-0000000f0108')::uuid, 'privacy-policy', 1, 'withdrawn'::public.consent_action
union all select ('00000000-0000-0000-0000-0000000f0105')::uuid, 'employer-terms', 1, 'granted'::public.consent_action;

select is(pg_temp.publish_as(:'st_admin', 'privacy-policy', 'Privacy policy', 'A long new body that must not travel.', :'summary'), 'ok', 'AC10: the privacy policy gets version 2');
select is(pg_temp.fan_out('privacy-policy'), 5, 'AC10: exactly 5 emails are queued');
select is(
  pg_temp.told('privacy-policy'),
  '00000000-0000-0000-0000-0000000f0101,00000000-0000-0000-0000-0000000f0102,00000000-0000-0000-0000-0000000f0103,00000000-0000-0000-0000-0000000f0104,00000000-0000-0000-0000-0000000f0105',
  'AC10: one for each of the 5 who accepted it, the user with the digest preference included; not the deleted, the never-accepted and the withdrawn'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and payload ->> 'document_slug' = 'privacy-policy' and msg_id is not null), 5::bigint,
  'AC10: they are mandatory, so the digest preference does not hold one back'
);
select is(
  (select string_agg(distinct (payload - 'document_slug' - 'version' - 'change_summary')::text, ',') from public.notifications
   where kind = 'legal_version' and payload ->> 'document_slug' = 'privacy-policy'),
  '{}', 'AC10: the payload holds the slug, the version and the change summary and nothing else, so never the body'
);
select is(
  (select count(*) from public.notifications where kind = 'legal_version' and payload ->> 'version' = '2' and payload ->> 'change_summary' = :'summary'), 5::bigint,
  'AC10: each names the version and the change summary'
);
select pg_temp.publish_as(:'st_admin', 'cookie-policy', 'Cookie policy', 'A new body.', :'summary') as cookie \gset
select is(pg_temp.fan_out('cookie-policy'), 0, 'AC10: the cookie policy, which nobody accepted, queues none');
select pg_temp.publish_as(:'st_admin', 'employer-terms', 'Employer terms', 'A new body.', :'summary') as employer \gset
select is(pg_temp.fan_out('employer-terms'), 1, 'AC10: the employer terms queue exactly 1');
select is(pg_temp.told('employer-terms'), '00000000-0000-0000-0000-0000000f0105', 'AC10: for the employer owner and for no candidate');
select is(pg_temp.fan_out('privacy-policy'), 0, 'a job that runs again queues nothing twice');

-- FR-H3 AC9 (database part): the re-consent is pending for the version, and only the current version can be accepted
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000f0101', 'authenticated',
    $$select set_config('t.pending', (select string_agg(slug || ':' || version || ':' || change_summary, ',') from public.pending_reconsents() where slug = 'privacy-policy'), true)$$, 'aal1'),
  'ok', 'the pending list can be read'
);
select is(current_setting('t.pending'), 'privacy-policy:2:' || :'summary', 'AC9: the user whose latest consent is version 1 is asked for version 2 with its change summary');
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000f0101', 'authenticated', $$select public.accept_consents('[{"purpose": "privacy-policy", "version": 1}]')$$, 'aal1'),
  'P0001|CHARA_CONSENT_REQUIRED|privacy-policy', 'AC9: accepting a version that is not the current one is refused'
);
select is(
  (select count(*) from public.consents where user_id = '00000000-0000-0000-0000-0000000f0101' and purpose = 'privacy-policy'), 1::bigint,
  'AC9: and inserts no row'
);
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000f0101', 'authenticated', $$select public.accept_consents('[{"purpose": "privacy-policy", "version": 2}]')$$, 'aal1'),
  'ok', 'AC9: accepting the current version works'
);
select is(
  (select format('%s|%s|%s', purpose, version, action) from public.consents where user_id = '00000000-0000-0000-0000-0000000f0101' order by id desc limit 1),
  'privacy-policy|2|granted', 'AC9: and inserts a granted row for version 2'
);
select is(
  pg_temp.call_as('00000000-0000-0000-0000-0000000f0101', 'authenticated',
    $$select set_config('t.pending', coalesce((select string_agg(slug, ',') from public.pending_reconsents() where slug = 'privacy-policy'), 'none'), true)$$, 'aal1'),
  'ok', 'the pending list is read after the acceptance'
);
select is(current_setting('t.pending'), 'none', 'AC9: the user whose latest consent is the current version is not asked');

-- the console list of the current versions
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(is_draft::text, ',') from public.admin_list_legal_documents() where slug in ('h3-terms', 'h3-privacy')$$),
  'false,true', 'the console list says which current version is a draft (h3-privacy is approved again, h3-terms is a draft)'
);
select is(
  pg_temp.call_as(:'st_trust', 'authenticated', $$select * from public.admin_list_legal_documents()$$), 'P0001|CHARA_FORBIDDEN|',
  'and is refused to Trust & Safety'
);

-- the export of every version
select is(
  (select string_agg(split_part(pg_temp.call_as(c.id, c.role_name, $$select * from public.admin_export_legal_documents()$$, c.aal), '|', 2), ',' order by c.n)
   from (values (1, :'st_trust'::uuid, 'authenticated', 'aal2'), (2, :'st_review'::uuid, 'authenticated', 'aal2'), (3, :'wa'::uuid, 'authenticated', 'aal2'),
                (4, :'st_admin'::uuid, 'authenticated', 'aal1')) c (n, id, role_name, aal)),
  'CHARA_FORBIDDEN,CHARA_FORBIDDEN,CHARA_FORBIDDEN,CHARA_FORBIDDEN',
  'the export is refused to Trust & Safety, a Verification Reviewer, a candidate and an administrator at aal1'
);
select is(
  pg_temp.call_as(null, 'anon', $$select * from public.admin_export_legal_documents()$$), '42501|permission denied for function admin_export_legal_documents|',
  'and to the anonymous caller'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(k, ',' order by k) from (select jsonb_object_keys(to_jsonb(e)) k from public.admin_export_legal_documents(null, null, 1) e) x$$),
  'body,change_summary,is_draft,published_at,slug,title,version', 'AC11: an entry holds slug, version, title, body, change_summary, is_draft and published_at'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select count(*)::text from public.admin_export_legal_documents(null, null, 100)$$),
  least(100, (select count(*) from public.legal_documents where published_at <= now()))::text,
  'AC11: the administrator at aal2 exports every published version'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select count(*)::text from public.admin_export_legal_documents(null, null, 100) where slug = 'h3-unpublished' or (slug = 'h3-terms' and version = 4)$$),
  '0', 'a version that is not published yet is not in the export'
);
select is(
  pg_temp.val_as(:'st_admin', 'aal2', $$select string_agg(slug || ':' || version, ',') from public.admin_export_legal_documents(null, null, 2)$$),
  (select string_agg(slug || ':' || version, ',' order by slug, version) from (select slug, version from public.legal_documents where published_at <= now() order by slug, version limit 2) x),
  'a page of 2 holds the first two versions in the order of slug and version'
);
select pg_temp.val_as(:'st_admin', 'aal2', $$select (array_agg(slug || '|' || version order by slug, version))[2] from public.admin_export_legal_documents(null, null, 2)$$) as last_of_page \gset
select is(
  pg_temp.val_as(:'st_admin', 'aal2',
    format($f$select string_agg(slug || ':' || version, ',') from public.admin_export_legal_documents(%L, %s, 2)$f$, split_part(:'last_of_page', '|', 1), split_part(:'last_of_page', '|', 2))),
  (select string_agg(slug || ':' || version, ',' order by slug, version) from (select slug, version from public.legal_documents where published_at <= now() order by slug, version offset 2 limit 2) x),
  'the next page starts after the last row of the page before'
);

-- AC4: if the job cannot be queued, no version remains
select pgmq.drop_queue('account_ops');
select is(
  split_part(pg_temp.publish_as(:'st_admin', 'h3-atomic', 'Atomic', 'Body.', :'summary'), '|', 1), '42P01',
  'AC4: a publication whose job cannot be queued fails'
);
select is(
  (select count(*) from public.legal_documents where slug = 'h3-atomic') + (select count(*) from audit.log where entity_id = 'h3-atomic:1'), 0::bigint,
  'AC4: and leaves no version and no audit row'
);

select * from finish();
rollback;
