begin;
select plan(46);

\ir status_fixture.inc

-- FR-D5: the internal notes and the refusal of direct writes. note_as inserts a note as a caller and returns 'ok' or
-- 'sqlstate|message|detail'; n_as counts the rows a query returns for a caller.
create function pg_temp.note_as(
  p_user uuid, p_app uuid, p_org uuid, p_body text default 'Call on Monday', p_author uuid default null
) returns text
language sql as $$
  select pg_temp.call_as(
    p_user, 'authenticated',
    case when p_author is null
      then format('insert into public.application_notes (application_id, organization_id, body) values (%L, %L, %L)', p_app, p_org, p_body)
      else format('insert into public.application_notes (application_id, organization_id, author_id, body) values (%L, %L, %L, %L)', p_app, p_org, p_author, p_body)
    end,
    'aal1'
  )
$$;

create function pg_temp.n_as(p_user uuid, p_sql text, p_aal text default 'aal1') returns text
language sql as $$ select pg_temp.val_as(p_user, p_aal, 'select count(*) from (' || p_sql || ') q') $$;

create function pg_temp.fixed_state() returns text
language sql as $$
  select (select count(*) from public.job_applications) || ',' || (select count(*) from public.application_events) || ','
      || (select count(*) from public.application_notes) || ',' || (select string_agg(status::text, ',' order by id) from public.job_applications)
$$;

select pg_temp.seed_app('applied') as x \gset
create temp table t_beta as select pg_temp.org_on() as org;

-- AC2: no direct write to applications and events, by the candidate or by a member; the candidate's note is refused by the policy.
select pg_temp.fixed_state() as before \gset
create function pg_temp.direct_writes(p_user uuid) returns text
language plpgsql as $fn$
declare
  v_sql text;
  v_out text := '';
begin
  foreach v_sql in array array[
    format($$insert into public.job_applications (job_id, organization_id, worker_user_id, passport_share_id, profile_snapshot)
             select job_id, organization_id, worker_user_id, passport_share_id, profile_snapshot from public.job_applications where id = %L$$, current_setting('t.x')),
    format($$update public.job_applications set status = 'hired' where id = %L$$, current_setting('t.x')),
    format($$update public.job_applications set cover_note = 'x' where id = %L$$, current_setting('t.x')),
    format($$update public.job_applications set worker_user_id = %L where id = %L$$, p_user, current_setting('t.x')),
    format($$update public.job_applications set profile_snapshot = '{}' where id = %L$$, current_setting('t.x')),
    'delete from public.job_applications',
    format($$insert into public.application_events (application_id, to_status) values (%L, 'hired')$$, current_setting('t.x')),
    'update public.application_events set note = ''x''',
    'delete from public.application_events'
  ] loop
    v_out := v_out || split_part(pg_temp.call_as(p_user, 'authenticated', v_sql, 'aal1'), '|', 1) || ' ';
  end loop;
  return v_out;
end;
$fn$;
select set_config('t.x', :'x', true) as keep_x \gset
select is(pg_temp.direct_writes(:'wa'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 ', 'AC2: every direct write of the candidate to applications and events is refused with 42501');
select is(pg_temp.direct_writes(:'mem'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 ', 'AC2: so is every direct write of a member of the organisation');
select is(pg_temp.note_as(:'wa', :'x', current_setting('t.a')::uuid), '42501|new row violates row-level security policy for table "application_notes"|', 'AC2: the candidate''s note is refused by the row-level security policy');
select is(pg_temp.fixed_state(), :'before', 'AC2: nothing changed');
select is(
  pg_temp.call_as(:'wa', 'authenticated', 'update public.application_notes set body = ''x''', 'aal1') || pg_temp.call_as(:'wa', 'authenticated', 'delete from public.application_notes', 'aal1'),
  '42501|permission denied for table application_notes|42501|permission denied for table application_notes|',
  'AC2: the candidate can neither update nor delete a note'
);

-- AC5 and AC6: notes.
select is(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid), 'ok', 'AC6: a member of the application''s organisation adds a note as themselves');
select is(
  (select author_id::text || ',' || organization_id::text || ',' || application_id::text || ',' || body from public.application_notes),
  :'mem' || ',' || current_setting('t.a') || ',' || :'x' || ',Call on Monday', 'AC6: the author, the organisation and the application are those of the call'
);
select is(pg_temp.note_as(pg_temp.member_of((select org from t_beta)), :'x', (select org from t_beta)), '23503|insert or update on table "application_notes" violates foreign key constraint "application_notes_application_id_organization_id_fkey"|Key is not present in table "job_applications".', 'AC6: a member of B cannot attach a note to an application of A under B');
select is(pg_temp.note_as(:'mem', :'x', (select org from t_beta)), '42501|new row violates row-level security policy for table "application_notes"|', 'AC6: a member of A cannot file a note under B');
select is(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, 'Another author', :'adm'), '42501|new row violates row-level security policy for table "application_notes"|', 'AC6: a member cannot write a note under another author');
select is(pg_temp.note_as(:'adm', :'x', current_setting('t.a')::uuid, 'Weak English'), 'ok', 'AC6: an admin adds a note');
select is((select count(*) from public.application_notes), 2::bigint, 'AC6: two notes exist, the refused ones left none');

select is(pg_temp.n_as(:'own1', 'select 1 from public.application_notes'), '2', 'AC5: the owner of A reads the notes');
select is(pg_temp.n_as(:'adm', 'select 1 from public.application_notes'), '2', 'AC5: an admin of A reads them');
select is(pg_temp.n_as(:'mem', 'select 1 from public.application_notes'), '2', 'AC5: a member of A reads them');
select is(pg_temp.n_as(:'own2', 'select 1 from public.application_notes') || pg_temp.n_as(pg_temp.member_of((select org from t_beta)), 'select 1 from public.application_notes'), '00', 'AC5: members of B read none');
select is(pg_temp.n_as(:'wa', 'select 1 from public.application_notes'), '0', 'AC5: the candidate who owns the application reads none');
select is(pg_temp.n_as(:'wb', 'select 1 from public.application_notes'), '0', 'AC5: nor does another candidate');
select is(pg_temp.n_as(:'st_admin', 'select 1 from public.application_notes', 'aal2') || pg_temp.n_as(:'st_trust', 'select 1 from public.application_notes', 'aal2') || pg_temp.n_as(:'st_review', 'select 1 from public.application_notes', 'aal2'), '000', 'AC5: the three staff roles read none');
select is(pg_temp.call_as(null, 'anon', 'select 1 from public.application_notes'), '42501|permission denied for table application_notes|', 'AC5: an anonymous session is denied');
select is(pg_temp.n_as(:'pending', 'select 1 from public.application_notes'), '0', 'AC5: a pending invitation reads none');
select is(
  pg_temp.n_as(:'wa', 'select 1 from public.v_my_application_timeline where note ilike ''%Weak English%'''), '0',
  'AC5: the text of an internal note is in nothing the candidate reads'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', 'select count(*) from public.my_applications() m where m::text ilike ''%Weak English%'''), '0',
  'AC5: not in the candidate''s list either'
);
select is(
  pg_temp.val_as(:'wa', 'aal1', 'select count(*) from public.application_events where note ilike ''%Weak English%'''), '0',
  'AC5: nor in the events'
);

-- The note, as a row.
select is(split_part(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, ''), '|', 1), '23514', 'an empty note is refused');
select is(split_part(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, '   '), '|', 1), '23514', 'a note of blanks is refused');
select is(split_part(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, ' padded '), '|', 1), '23514', 'a note that is not trimmed is refused');
select is(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, repeat('a', 2000)), 'ok', 'a note of 2000 characters is stored');
select is(split_part(pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid, repeat('a', 2001)), '|', 1), '23514', 'a note of 2001 characters is refused');
select is(
  pg_temp.call_as(:'mem', 'authenticated', format($$update public.application_notes set body = 'Changed' where application_id = %L$$, :'x'), 'aal1')
    || pg_temp.call_as(:'mem', 'authenticated', 'delete from public.application_notes', 'aal1')
    || pg_temp.call_as(:'own1', 'authenticated', 'delete from public.application_notes', 'aal2'),
  '42501|permission denied for table application_notes|42501|permission denied for table application_notes|42501|permission denied for table application_notes|',
  'a note is append-only: a member and the owner can neither update nor delete it'
);
select is(pg_temp.call_as(null, 'service_role', 'delete from public.application_notes', 'aal1'), '42501|permission denied for table application_notes|', 'service_role cannot delete a note');
select is(pg_temp.call_as(:'mem', 'authenticated', format($$insert into public.application_notes (created_at, application_id, organization_id, body) values (now(), %L, %L, 'x')$$, :'x', current_setting('t.a')), 'aal1'), '42501|permission denied for table application_notes|', 'the time is not the caller''s to set');

-- A pending invitation, another candidate, platform staff and an anonymous session cannot add a note.
select is(split_part(pg_temp.note_as(:'pending', :'x', current_setting('t.a')::uuid), '|', 1), '42501', 'a pending invitation cannot add a note');
select is(split_part(pg_temp.note_as(:'wb', :'x', current_setting('t.a')::uuid), '|', 1), '42501', 'another candidate cannot add a note');
select is(split_part(pg_temp.call_as(:'st_admin', 'authenticated', format($$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'x')$$, :'x', current_setting('t.a')), 'aal2'), '|', 1), '42501', 'platform staff cannot add a note');
select is(pg_temp.call_as(null, 'anon', format($$insert into public.application_notes (application_id, organization_id, body) values (%L, %L, 'x')$$, :'x', current_setting('t.a'))), '42501|permission denied for table application_notes|', 'an anonymous session cannot add a note');

-- AC9: a lapsed organisation cannot add notes; an outsider learns nothing about its plan; a suspended organisation cannot either.
create temp table t_lapsed as select pg_temp.org_on('employer_starter', 'canceled') as org;
select pg_temp.seed_app('applied', (select org from t_lapsed)) as lapsed_app \gset
select is(
  pg_temp.note_as(pg_temp.member_of((select org from t_lapsed)), :'lapsed_app', (select org from t_lapsed)),
  'P0001|CHARA_FEATURE_NOT_IN_PLAN|read_only_free_plan', 'AC9: a member of a lapsed organisation cannot add a note'
);
select is(
  pg_temp.note_as(:'mem', :'lapsed_app', (select org from t_lapsed)), '42501|new row violates row-level security policy for table "application_notes"|',
  'AC9: a member of another organisation gets the policy refusal, not the plan'
);
create temp table t_susp as select pg_temp.org_on() as org;
select pg_temp.seed_app('applied', (select org from t_susp)) as susp_app \gset
update public.organizations set status = 'suspended' where id = (select org from t_susp);
select is(
  pg_temp.note_as(pg_temp.member_of((select org from t_susp)), :'susp_app', (select org from t_susp)),
  'P0001|CHARA_FORBIDDEN|organization_suspended', 'a member of a suspended organisation cannot add a note'
);
select is((select count(*) from public.application_notes), 3::bigint, 'only the three accepted notes exist');

-- AC4: a removed member cannot add a note from the next statement on.
select is(
  pg_temp.call_as(:'own1', 'authenticated', format('select public.remove_member(%L, %L)', current_setting('t.a'), :'mem'), 'aal2'), 'ok',
  'AC4: the owner removes a member'
);
select is(
  pg_temp.note_as(:'mem', :'x', current_setting('t.a')::uuid), '42501|new row violates row-level security policy for table "application_notes"|',
  'AC4: the removed member''s note is refused by the row-level security policy'
);
select is((select count(*) from public.application_notes), 3::bigint, 'AC4: and no note was added');

-- The erasure of a candidate (FR-B6) deletes the notes on their applications and leaves the others.
select pg_temp.seed_app('applied', current_setting('t.a')::uuid, :'wb') as wb_app \gset
insert into public.application_notes (application_id, organization_id, author_id, body) values (:'wb_app', current_setting('t.a')::uuid, :'own1', 'Ana Silva, weak English');
update public.profiles set deleted_at = now() - interval '31 days' where id = :'wb';
select is((select count(*) from public.application_notes where application_id = :'wb_app'), 1::bigint, 'the note on the application of the candidate who will be erased exists');
select is(pg_temp.call_as(null, 'service_role', format('select public.erase_user(%L)', :'wb')), 'ok', 'erase_user runs for that candidate');
select is(
  (select count(*) from public.application_notes where application_id = :'wb_app') || '/' || (select count(*) from public.application_notes),
  '0/3', 'the note on their application is deleted and the three others stay'
);

select * from finish();
rollback;
