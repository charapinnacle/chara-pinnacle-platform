begin;
select plan(32);

\ir privacy_fixture.inc

-- These tests count the rows of single calls; the repeat window is tested in 036.
update private.settings set value = '0' where key = 'document_access_repeat_seconds';

\set d4 '00000000-0000-0000-0000-0000000d0004'
\set d5 '00000000-0000-0000-0000-0000000d0005'
\set d9 '00000000-0000-0000-0000-0000000d0009'
\set d10 '00000000-0000-0000-0000-0000000d0010'
\set d11 '00000000-0000-0000-0000-0000000d0011'
\set d12 '00000000-0000-0000-0000-0000000d0012'
\set dd '00000000-0000-0000-0000-0000000d00d1'
\set unknown '00000000-0000-0000-0000-0000000d0fff'

create function pg_temp.o() returns uuid language sql as $$ select current_setting('t.o')::uuid $$;
create function pg_temp.p() returns uuid language sql as $$ select current_setting('t.p')::uuid $$;
create function pg_temp.logged() returns bigint language sql as $$ select count(*) from audit.document_access_log $$;

select pg_temp.doc(:'d1', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d1']::uuid[]);

-- The state of the document: unknown, deleted, pending and rejected files give no path.
select pg_temp.doc(:'d9', :'wa');
select pg_temp.doc(:'d10', :'wa', 'pending');
select pg_temp.doc(:'d11', :'wa', 'rejected');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d9', :'d10', :'d11']::uuid[]);
update public.worker_documents set deleted_at = now() where id = :'d9';

select is(pg_temp.grant_as(:'mem', :'unknown', p_aal => 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'an unknown document id is not found');
select is(pg_temp.grant_as(:'mem', null, p_aal => 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'a null document id is not found');
select is(pg_temp.grant_as(:'mem', :'d9', p_aal => 'aal1'), 'P0002|CHARA_NOT_FOUND|', 'a deleted document is not found, also while its share is active');
select is(pg_temp.grant_as(:'mem', :'d10', p_aal => 'aal1'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'a pending document of the share is not served');
select is(pg_temp.grant_as(:'mem', :'d11', p_aal => 'aal1'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'a rejected document of the share is not served');
select is(pg_temp.grant_as(:'wa', :'d11', 'owner_download', 'aal1'), 'P0001|CHARA_DOCUMENT_NOT_SCANNED|', 'nor to the owner');
select is(pg_temp.grant_as(:'own2', :'d10'), '42501|CHARA_FORBIDDEN|', 'a stranger learns nothing of the scan state: forbidden, not unscanned');
select is(pg_temp.logged(), 0::bigint, 'no refusal wrote a row');

-- A suspended organisation and a candidate whose deletion is pending give no access.
select pg_temp.doc(:'d12', :'wa');
select pg_temp.share(pg_temp.p(), :'wa', array[:'d12']::uuid[]);
select is(pg_temp.grant_as(:'own2', :'d12'), 'ok', 'setup: a member of P opens the document shared with P');
update public.organizations set status = 'suspended' where id = pg_temp.p();
select is(pg_temp.grant_as(:'own2', :'d12'), '42501|CHARA_FORBIDDEN|', 'a suspended organisation is refused');
update public.organizations set status = 'active' where id = pg_temp.p();
select is(pg_temp.grant_as(:'own2', :'d12'), 'ok', 'and is served again when reinstated');

select pg_temp.doc(:'dd', :'wb');
select pg_temp.share(pg_temp.o(), :'wb', array[:'dd']::uuid[]);
select is(pg_temp.grant_as(:'mem', :'dd', p_aal => 'aal1'), 'ok', 'setup: a member of O opens the document of candidate B');
update public.profiles set status = 'deletion_pending' where id = :'wb';
select is(pg_temp.grant_as(:'mem', :'dd', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'a candidate whose deletion is pending gives no access');
update public.profiles set status = 'suspended' where id = :'wb';
select is(pg_temp.grant_as(:'mem', :'dd', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'a suspended candidate gives no access');
update public.profiles set status = 'active' where id = :'wb';
select is(pg_temp.logged(), 3::bigint, 'only the three successful openings are logged');

-- A share whose consent is missing or belongs to someone else grants nothing.
select pg_temp.doc(:'d4', :'wa');
insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
values (:'wa', pg_temp.o(), pg_temp.stub_application(pg_temp.o(), :'wa'), to_jsonb(array[:'d4']::uuid[]), -1);
select is(pg_temp.grant_as(:'mem', :'d4', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'a share with no consent row grants nothing');
insert into public.consents (user_id, purpose, version, action) values (:'wb', 'sharing-notice', 1, 'granted');
select pg_temp.doc(:'d5', :'wa');
insert into public.passport_shares (worker_user_id, organization_id, application_id, scope, consent_id)
values (:'wa', pg_temp.o(), pg_temp.stub_application(pg_temp.o(), :'wa'), to_jsonb(array[:'d5']::uuid[]), (select max(id) from public.consents where user_id = :'wb'));
select is(pg_temp.grant_as(:'mem', :'d5', p_aal => 'aal1'), '42501|CHARA_FORBIDDEN|', 'a share whose consent belongs to another person grants nothing');

-- The purpose follows the caller: application_review for a member of the organisation, owner_download for the owner. Any
-- other value, and the other caller's value, is refused and writes no row.
select is(pg_temp.grant_as(:'mem', :'d1', null, 'aal1'), '42501|CHARA_FORBIDDEN|purpose_mismatch', 'a null purpose is refused');
select is(pg_temp.grant_as(:'mem', :'d1', '', 'aal1'), '42501|CHARA_FORBIDDEN|purpose_mismatch', 'an empty purpose is refused');
select is(pg_temp.grant_as(:'mem', :'d1', 'other', 'aal1'), '42501|CHARA_FORBIDDEN|purpose_mismatch', 'an unknown purpose is refused');
select is(pg_temp.grant_as(:'mem', :'d1', 'owner_download', 'aal1'), '42501|CHARA_FORBIDDEN|purpose_mismatch', 'a member of the organisation cannot label the opening an owner download');
select is(pg_temp.grant_as(:'wa', :'d1', 'application_review', 'aal1'), '42501|CHARA_FORBIDDEN|purpose_mismatch', 'the owner cannot label the opening an application review');
select is(pg_temp.logged(), 3::bigint, 'a refused purpose wrote no row');

-- Anonymous and tokenless callers.
select is(
  split_part(pg_temp.call_as(null, 'anon', format($$select * from public.document_access_grant(%L, 'application_review')$$, :'d1')), '|', 1),
  '42501', 'anonymous callers have no execute grant'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', format($$select * from public.document_access_grant(%L, 'application_review')$$, :'d1')), '|', 2) ~ '^permission denied',
  true, 'and are refused by the missing grant, not by the function'
);
select is(
  pg_temp.call_as(null, 'authenticated', format($$select * from public.document_access_grant(%L, 'application_review')$$, :'d1')),
  '42501|CHARA_UNAUTHENTICATED|', 'an authenticated role without a user id is refused'
);
select is(
  has_function_privilege('service_role', 'public.document_access_grant(uuid, text)', 'execute'), false,
  'service_role cannot execute the grant'
);

-- The owner downloads own document through the same door; the row names no organisation.
select is(pg_temp.grant_as(:'wa', :'d1', 'owner_download', 'aal1'), 'ok', 'the owner opens the own document');
select is(
  (select format('%s|%s|%s|%s', share_id is null, organization_id is null, accessed_by = :'wa', purpose)
   from audit.document_access_log order by id desc limit 1),
  't|t|t|owner_download', 'the owner row has no share and no organisation'
);

-- The quarterly privacy check of docs/runbooks/platform-staff.md (KPI: privacy incidents, target 0), the same text.
create function pg_temp.incidents() returns setof bigint language sql as $$
  select l.id
  from audit.document_access_log l
  left join public.passport_shares s on s.id = l.share_id
  where (l.purpose = 'owner_download') is distinct from (l.accessed_by = l.worker_user_id)
     or (s.id is null and l.accessed_by <> l.worker_user_id)
     or (s.id is not null and (
          not s.scope ? l.document_id::text
       or l.accessed_at >= s.revoked_at
       or l.accessed_at >= s.expires_at
       or s.organization_id is distinct from l.organization_id
       or s.worker_user_id is distinct from l.worker_user_id
       or exists (
            select 1 from public.consents c
            join public.consents w on w.user_id = c.user_id and w.purpose = c.purpose and w.action = 'withdrawn' and w.id > c.id
            where c.id = s.consent_id and w.created_at <= l.accessed_at)))
$$;

select is_empty('select * from pg_temp.incidents()', 'no log row of the legitimate openings is an incident');

-- Negative control: each kind of bad opening, written straight into the log, is found and nothing else is.
select pg_temp.doc(:'d2', :'wa');
select pg_temp.share(pg_temp.o(), :'wa', array[:'d2']::uuid[], 'sharing-notice-b');
insert into public.consents (user_id, purpose, version, action) values (:'wa', 'sharing-notice-b', 1, 'withdrawn');
create temp table bad (id bigint) on commit drop;
with ins as (
  insert into audit.document_access_log (share_id, document_id, worker_user_id, organization_id, accessed_by, purpose)
  select s.id, v.doc, :'wa'::uuid, s.organization_id, :'mem'::uuid, v.purpose
  from public.passport_shares s, (values (:'d3'::uuid, 'application_review'), (:'d1'::uuid, 'owner_download')) as v (doc, purpose)
  where s.worker_user_id = :'wa' and s.scope ? :'d1'
  union all
  select s.id, :'d2'::uuid, :'wa'::uuid, s.organization_id, :'mem'::uuid, 'application_review'
  from public.passport_shares s where s.scope ? :'d2'
  union all
  select null::uuid, :'d1'::uuid, :'wa'::uuid, null::uuid, :'mem'::uuid, 'application_review'
  union all
  select gen_random_uuid(), :'d1'::uuid, :'wa'::uuid, pg_temp.o(), :'mem'::uuid, 'application_review'
  returning id
)
insert into bad select id from ins;
select is((select count(*) from bad), 5::bigint, 'setup: out of scope, mislabelled, after a withdrawal, share-less and share-gone openings');
select results_eq('select * from pg_temp.incidents() order by 1', 'select id from bad order by 1', 'the review query returns exactly the bad openings');

select * from finish();
rollback;
