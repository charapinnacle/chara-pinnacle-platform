begin;
select plan(33);

\ir search_fixture.inc

-- FR-A2, FR-C4 (OPEN_QUESTIONS.md D82): the description of the company, written by an owner or administrator through
-- update_organization_profile and returned by get_public_job.

create function pg_temp.describe_as(
  p_user uuid, p_org uuid, p_description text, p_aal text default 'aal2', p_role text default 'authenticated'
) returns text
language sql as $$
  select pg_temp.call_as(p_user, p_role, format(
    $f$select public.update_organization_profile(%L, 'Acme Bau GmbH', 'Acme Bau', 'DE', 'F', 'https://acme.example', %L)$f$,
    p_org, p_description), p_aal)
$$;

create function pg_temp.description(p_org uuid) returns text
language sql as $$ select coalesce(description, '<null>') from public.organizations where id = p_org $$;

-- The row of the page as an anonymous caller reads it, as JSON; null when there is none.
create function pg_temp.page_json(p_id uuid) returns jsonb
language plpgsql as $$
declare
  v_row jsonb;
begin
  set local role anon;
  select to_jsonb(g) into v_row from public.get_public_job(p_id) g;
  reset role;
  return v_row;
end;
$$;

create function pg_temp.updates(p_org uuid) returns bigint
language sql as $$ select count(*) from audit.log where action = 'organization.updated' and entity_id = p_org::text $$;

update public.organizations set website = 'https://acme.example' where id = current_setting('t.a')::uuid;
select current_setting('t.a') as a \gset
select pg_temp.seed_job('{"title": "Description vacancy", "status": "open"}') as v \gset

-- Structure
select col_type_is('public', 'organizations', 'description', 'text', 'the description is text');
select col_is_null('public', 'organizations', 'description', 'and optional');
select is(
  (select count(*) from pg_constraint where conrelid = 'public.organizations'::regclass and conname = 'organizations_description_check'),
  1::bigint, 'a check constraint guards the length and the trimming'
);

-- The constraint, as the database owner writes
select throws_ok(
  format($$update public.organizations set description = '' where id = %L$$, :'a'), '23514', null,
  'an empty description is not stored: it is null'
);
select throws_ok(
  format($$update public.organizations set description = ' padded ' where id = %L$$, :'a'), '23514', null,
  'a description with spaces at its ends is refused'
);
select throws_ok(
  format($$update public.organizations set description = %L where id = %L$$, repeat('x', 2001), :'a'), '23514', null,
  'a description of 2001 characters is refused'
);
select lives_ok(
  format($$update public.organizations set description = %L where id = %L$$, repeat('y', 2000), :'a'), 'and one of 2000 characters is kept'
);
update public.organizations set description = null where id = :'a';

-- AC: an owner or an administrator saves it, trimmed, with its line breaks
select is(
  pg_temp.describe_as(:'own1', :'a', E'  \n We build steel halls.\n\n  Founded in 1999.  \n'), 'ok', 'the owner at aal2 saves a description'
);
select is(
  pg_temp.description(:'a'), E'We build steel halls.\n\n  Founded in 1999.',
  'its ends are trimmed and the line breaks and spaces inside it are kept'
);
select is(
  (select metadata from audit.log where action = 'organization.updated' and entity_id = :'a' order by id desc limit 1),
  '{"changed_fields": ["description"], "duplicate_legal_name": false}'::jsonb,
  'the audit row names the field that changed and carries no text of it'
);
select is(
  (select count(*) from audit.log where entity_id = :'a' and metadata::text like '%steel halls%'), 0::bigint,
  'the text of the description is nowhere in the audit log'
);
select is(pg_temp.describe_as(:'adm', :'a', E'We build steel halls.\n\n  Founded in 1999.'), 'ok', 'an administrator saves the same text');
select is(pg_temp.updates(:'a'), 1::bigint, 'a description that did not change writes no audit row');
select is(pg_temp.describe_as(:'adm', :'a', 'Steel halls and bridges.'), 'ok', 'an administrator changes it');
select is(pg_temp.updates(:'a'), 2::bigint, 'and the change is audited once');
select is(
  pg_temp.describe_as(:'own1', :'a', '<script>alert(1)</script> & <b>bold</b>'), 'ok', 'markup is stored as the characters it is'
);
select is(pg_temp.description(:'a'), '<script>alert(1)</script> & <b>bold</b>', 'and is not changed');

-- Boundaries
select is(
  pg_temp.describe_as(:'own1', :'a', repeat('z', 2001)), 'P0001|CHARA_INVALID_INPUT|organizations_description_check',
  'a description of 2001 characters is refused with the name of the constraint'
);
select is(pg_temp.describe_as(:'own1', :'a', repeat('z', 2000)), 'ok', 'one of 2000 characters is accepted');
select is(pg_temp.describe_as(:'own1', :'a', E' \n\t '), 'ok', 'a description of white space only is accepted');
select is(pg_temp.description(:'a'), '<null>', 'and clears it');
select is(pg_temp.describe_as(:'own1', :'a', null), 'ok', 'a missing description is accepted');
select is(pg_temp.description(:'a'), '<null>', 'and stays empty');

-- Callers who may not
select pg_temp.describe_as(:'own1', :'a', 'Stays as it is.') as keep \gset
select is(pg_temp.describe_as(:'mem', :'a', 'Member text.'), 'P0001|CHARA_FORBIDDEN|', 'a member is refused');
select is(pg_temp.describe_as(:'own2', :'a', 'Other owner.'), 'P0001|CHARA_FORBIDDEN|', 'the owner of another organisation is refused');
select is(pg_temp.describe_as(:'own1', :'a', 'Owner at aal1.', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required', 'the owner at aal1 is refused');
select is(
  pg_temp.describe_as(null, :'a', 'Anonymous.', 'aal1', 'anon'), '42501|permission denied for function update_organization_profile|',
  'an anonymous caller has no execute grant'
);
select is(pg_temp.description(:'a'), 'Stays as it is.', 'the refused calls changed nothing');

-- The vacancy page
select is(
  pg_temp.page_json(:'v') ->> 'employer_description', 'Stays as it is.', 'the vacancy page returns the description of the employer to a visitor'
);
select pg_temp.describe_as(:'own1', :'a', E'Line one\nLine two') as set2 \gset
select is(
  pg_temp.page_json(:'v') ->> 'employer_description', E'Line one\nLine two', 'with its line breaks'
);
select pg_temp.describe_as(:'own1', :'a', null) as set3 \gset
select ok(pg_temp.page_json(:'v') -> 'employer_description' = 'null'::jsonb, 'an organisation without a description gives null');
select pg_temp.describe_as(:'own1', :'a', 'Hidden with the vacancy.') as set4 \gset
update public.jobs set moderation_state = 'hidden' where id = :'v';
select is(pg_temp.page_json(:'v'), null::jsonb, 'a vacancy that is not public gives no row, and so no description');

-- The table itself stays closed to a visitor
select is(
  pg_temp.call_as(null, 'anon', $$select description from public.organizations$$, 'aal1'),
  '42501|permission denied for table organizations|', 'an anonymous caller cannot select the description from the table'
);

select * from finish();
rollback;
