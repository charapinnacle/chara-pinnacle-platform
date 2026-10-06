begin;
select plan(57);

\ir jobs_fixture.inc

create function pg_temp.insert_returning_id(p_user uuid, p_org uuid, p_over jsonb default '{}') returns uuid
language plpgsql as $$
declare
  v_sql text := pg_temp.insert_job(p_org, p_over) || ' returning id';
  v_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  execute v_sql into v_id;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_id;
end;
$$;

-- FR-C1 AC7: who can insert, and which columns the client can never write.
select is(pg_temp.insert_as(:'own1', '{"title": "Owner vacancy"}'), 'ok', 'an owner of the organisation inserts a vacancy');
select is(pg_temp.insert_as(:'adm', '{"title": "Admin vacancy"}'), 'ok', 'an admin of the organisation inserts a vacancy');
select is(
  (select count(*) from public.jobs where title in ('Owner vacancy', 'Admin vacancy') and status = 'draft'
     and moderation_state = 'visible' and deleted_at is null and posted_on_behalf_of_organization_id is null
     and organization_id = current_setting('t.a')::uuid),
  2::bigint, 'both are visible drafts of the organisation without a hiring-on-behalf organisation'
);
select is((select created_by from public.jobs where title = 'Owner vacancy'), :'own1'::uuid, 'created_by is the owner');
select is((select created_by from public.jobs where title = 'Admin vacancy'), :'adm'::uuid, 'created_by is the admin');
select is(pg_temp.state_as(:'mem', pg_temp.insert_job(current_setting('t.a')::uuid)), '42501', 'a member cannot insert');
select is(pg_temp.state_as(:'adm2', pg_temp.insert_job(current_setting('t.a')::uuid)), '42501', 'an admin of another organisation cannot insert');
select is(pg_temp.state_as(:'wa', pg_temp.insert_job(current_setting('t.a')::uuid)), '42501', 'a candidate cannot insert');
select is(pg_temp.state_as(:'wa', pg_temp.insert_job(current_setting('t.b')::uuid)), '42501', 'a candidate cannot insert into any organisation');
select is(
  split_part(pg_temp.call_as(null, 'anon', pg_temp.insert_job(current_setting('t.a')::uuid)), '|', 1), '42501',
  'an anonymous caller has no insert grant'
);
select is((select count(*) from public.jobs), 2::bigint, 'the refused inserts created no row');

select is(
  pg_temp.state_as(:'adm', pg_temp.insert_job(current_setting('t.a')::uuid, '{"status": "open"}')), '42501',
  'status cannot be set at insert'
);
select is(
  pg_temp.state_as(:'adm', pg_temp.insert_job(current_setting('t.a')::uuid, jsonb_build_object('created_by', :'own1'))), '42501',
  'created_by cannot be set at insert'
);
select is(
  pg_temp.state_as(:'adm', pg_temp.insert_job(current_setting('t.a')::uuid, '{"moderation_state": "hidden"}')), '42501',
  'moderation_state cannot be set at insert'
);
select is(
  pg_temp.state_as(:'adm', pg_temp.insert_job(current_setting('t.a')::uuid, '{"deleted_at": "2026-01-01T00:00:00Z"}')), '42501',
  'deleted_at cannot be set at insert'
);
select is(
  pg_temp.state_as(:'adm', pg_temp.insert_job(current_setting('t.a')::uuid, jsonb_build_object('posted_on_behalf_of_organization_id', current_setting('t.b')))),
  '42501', 'the hiring-on-behalf organisation cannot be set in Phase 1'
);
select is((select count(*) from public.jobs), 2::bigint, 'the four reserved-column inserts created no row');

-- Reads: a draft is visible to the members of its organisation only.
select pg_temp.insert_returning_id(:'adm', current_setting('t.a')::uuid, '{"title": "Read check"}') as draft \gset
select is(pg_temp.val_as(:'own1', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '1', 'the owner reads the draft');
select is(pg_temp.val_as(:'adm', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '1', 'an admin reads the draft');
select is(pg_temp.val_as(:'mem', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '1', 'a member reads the draft');
select is(pg_temp.val_as(:'adm2', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '0', 'an admin of another organisation does not see the draft');
select is(pg_temp.val_as(:'own2', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '0', 'the owner of another organisation does not see the draft');
select is(pg_temp.val_as(:'wa', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '0', 'a candidate does not see the draft');
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 0::bigint, 'an anonymous visitor does not see the draft');

update public.jobs set status = 'open' where id = :'draft';
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 1::bigint, 'an open visible vacancy is public');
select is(pg_temp.val_as(:'wa', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '1', 'and a candidate reads it');
update public.jobs set moderation_state = 'hidden' where id = :'draft';
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 0::bigint, 'a hidden vacancy is not public');
select is(pg_temp.val_as(:'mem', 'aal1', format($$select count(*) from public.jobs where id = %L$$, :'draft')), '1', 'but its members still read it');
update public.jobs set moderation_state = 'org_suspended' where id = :'draft';
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 0::bigint, 'a vacancy of a suspended organisation is not public');
update public.jobs set moderation_state = 'visible', status = 'paused' where id = :'draft';
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 0::bigint, 'a paused vacancy is not public');
update public.jobs set status = 'open', deleted_at = now() where id = :'draft';
select is(pg_temp.affected_as(null, 'anon', format($$select id from public.jobs where id = %L$$, :'draft')), 0::bigint, 'a deleted vacancy is not public');
update public.jobs set status = 'draft', deleted_at = null where id = :'draft';

select is(pg_temp.state_as(:'adm', 'select created_by from public.jobs'), '42501', 'created_by is not readable through the API');
select is(pg_temp.state_as(:'adm', 'select search_vector from public.jobs'), '42501', 'the search vector is not readable through the API');
select is(
  split_part(pg_temp.call_as(null, 'anon', 'select title, city from public.jobs'), '|', 1), 'ok', 'an anonymous caller can read the public columns'
);
select is(
  split_part(pg_temp.call_as(null, 'anon', 'select created_by from public.jobs'), '|', 1), '42501', 'an anonymous caller cannot read created_by'
);

-- FR-C1 AC11: updates are validated, limited to owner and admin, and limited to the content columns.
select count(*) as base from audit.log where action = 'job.updated' and entity_id = :'draft' \gset
select is(
  pg_temp.affected_as(:'adm', 'authenticated', format($$update public.jobs set title = 'Welder 2' where id = %L$$, :'draft')),
  1::bigint, 'an admin changes the title to a valid value'
);
select is(
  (select count(*) from audit.log where action = 'job.updated' and entity_id = :'draft'), :base + 1::bigint,
  'the change wrote one audit row'
);
select is(
  (select metadata -> 'changed_fields' from audit.log where action = 'job.updated' and entity_id = :'draft' order by id desc limit 1),
  '["title"]'::jsonb, 'the audit row names the changed column'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set title = 'Weld' where id = %L$$, :'draft')), '23514',
  'a title of 4 characters is refused on update'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set salary_min = 5000, salary_max = 4000, salary_currency = 'EUR', salary_period = 'month' where id = %L$$, :'draft')),
  '23514', 'a minimum above the maximum is refused on update'
);
select is(
  (select count(*) from audit.log where action = 'job.updated' and entity_id = :'draft'), :base + 1::bigint,
  'the refused updates wrote no audit row'
);
select is(
  pg_temp.affected_as(:'mem', 'authenticated', format($$update public.jobs set title = 'Member edit' where id = %L$$, :'draft')),
  0::bigint, 'a member updates no row'
);
select is(
  pg_temp.affected_as(:'adm2', 'authenticated', format($$update public.jobs set title = 'Other edit' where id = %L$$, :'draft')),
  0::bigint, 'an admin of another organisation updates no row'
);
select is((select title from public.jobs where id = :'draft'), 'Welder 2', 'the title is unchanged by the refused edits');
select is(pg_temp.state_as(:'wa', format($$update public.jobs set title = 'Welder 3' where id = %L$$, :'draft')), 'ok', 'a candidate update is not an error');
select is((select title from public.jobs where id = :'draft'), 'Welder 2', 'but it changes nothing');
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set organization_id = %L where id = %L$$, current_setting('t.b'), :'draft')), '42501',
  'organization_id cannot be changed'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set created_by = %L where id = %L$$, :'own1', :'draft')), '42501',
  'created_by cannot be changed'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set moderation_state = 'hidden' where id = %L$$, :'draft')), '42501',
  'moderation_state cannot be changed'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set deleted_at = now() where id = %L$$, :'draft')), '42501',
  'deleted_at cannot be changed'
);
select is(
  pg_temp.state_as(:'adm', format($$update public.jobs set status = 'open' where id = %L$$, :'draft')), '42501',
  'status cannot be changed through the API before the lifecycle exists'
);

-- Delete: the owner only.
select is(pg_temp.affected_as(:'mem', 'authenticated', format($$delete from public.jobs where id = %L$$, :'draft')), 0::bigint, 'a member deletes no row');
select is(pg_temp.affected_as(:'adm', 'authenticated', format($$delete from public.jobs where id = %L$$, :'draft')), 0::bigint, 'an admin deletes no row');
select is(pg_temp.affected_as(:'adm2', 'authenticated', format($$delete from public.jobs where id = %L$$, :'draft')), 0::bigint, 'an admin of another organisation deletes no row');
select is(pg_temp.affected_as(:'own2', 'authenticated', format($$delete from public.jobs where id = %L$$, :'draft')), 0::bigint, 'the owner of another organisation deletes no row');
select is(pg_temp.affected_as(:'own1', 'authenticated', format($$delete from public.jobs where id = %L$$, :'draft')), 1::bigint, 'the owner deletes the draft');
select is(
  (select count(*) from audit.log where action = 'job.deleted' and entity_id = :'draft'), 1::bigint, 'the deletion wrote one audit row'
);

select * from finish();
rollback;
