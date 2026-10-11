begin;
select plan(31);

\ir search_fixture.inc

-- FR-C3 (OPEN_QUESTIONS.md D82): the Employer filter of search_jobs, a part of the display name of the organisation,
-- trimmed, escaped, any case, accents ignored, 2 to 100 characters.

create function pg_temp.sorted_titles(p_args text default '') returns text
language sql as $$
  select coalesce(string_agg(t, ',' order by t), '')
  from unnest(string_to_array(nullif(pg_temp.search_titles(p_args), ''), ',')) t
$$;

insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country) values
  ('00000000-0000-0000-0000-00000000e001', 'employer', 'mueller', 'Mueller Bau GmbH', U&'M\00FCller Bau', 'DE'),
  ('00000000-0000-0000-0000-00000000e002', 'employer', 'pct', 'Pct Works Ltd', 'Pct 100%_Works', 'GB');

select pg_temp.seed_job('{"title": "Acme vacancy", "status": "open"}') as j_acme \gset
select pg_temp.seed_job('{"title": "Beta vacancy", "status": "open"}', current_setting('t.b')::uuid) as j_beta \gset
select pg_temp.seed_job('{"title": "Mueller vacancy", "status": "open"}', '00000000-0000-0000-0000-00000000e001') as j_mueller \gset
select pg_temp.seed_job('{"title": "Pct vacancy", "status": "open"}', '00000000-0000-0000-0000-00000000e002') as j_pct \gset
select pg_temp.seed_job('{"title": "Acme draft", "status": "draft"}') as j_draft \gset
select pg_temp.seed_job('{"title": "Acme hidden", "status": "open", "moderation_state": "hidden"}') as j_hidden \gset
select pg_temp.seed_job('{"title": "Acme second", "status": "open", "created_at": "2026-01-01T10:00:00Z"}') as j_second \gset

-- The match
select is(pg_temp.sorted_titles('p_employer => ''acme'''), 'Acme second,Acme vacancy', 'a part of the display name finds the vacancies of that employer');
select is(pg_temp.sorted_titles('p_employer => ''ACME BAU'''), 'Acme second,Acme vacancy', 'in any case');
select is(pg_temp.sorted_titles('p_employer => ''  works  '''), 'Beta vacancy,Pct vacancy', 'ends trimmed, and the part may be anywhere in the name');
select is(pg_temp.sorted_titles('p_employer => ''bau'''), 'Acme second,Acme vacancy,Mueller vacancy', 'a part shared by two names finds both');
select is(pg_temp.sorted_titles(format('p_employer => %L', U&'M\00DCLLER')), 'Mueller vacancy', 'accents and case are ignored: the umlaut is found');
select is(pg_temp.sorted_titles('p_employer => ''muller'''), 'Mueller vacancy', 'and found by the name without the accent');
select is(pg_temp.sorted_titles('p_employer => ''gmbh'''), '', 'the legal name is not searched: the display name is the only name');
select is(pg_temp.sorted_titles('p_employer => ''nobody'''), '', 'a name nobody has finds nothing');
select is(
  pg_temp.sorted_titles('p_employer => ''acme'', p_q => ''second'''), 'Acme second',
  'the filter combines with the other filters'
);
select is(
  pg_temp.sorted_titles('p_employer => ''bau'', p_country => ''DE'''), 'Acme second,Acme vacancy,Mueller vacancy',
  'also with the country'
);
select is(
  pg_temp.sorted_titles('p_employer => ''works'', p_country => ''DE'''), 'Beta vacancy,Pct vacancy', 'a country of the vacancies keeps them'
);
select is(pg_temp.sorted_titles('p_employer => ''works'', p_country => ''FR'''), '', 'and another country leaves none');

-- Only public vacancies, and the public predicate still holds
select is(pg_temp.sorted_titles('p_employer => ''acme'''), 'Acme second,Acme vacancy', 'a draft and a hidden vacancy of the employer are not found');
select is(pg_temp.search_ids('authenticated', :'own1', 'p_employer => ''acme'''), pg_temp.search_ids('anon', null, 'p_employer => ''acme'''),
  'a member of the employer sees the same results as a visitor');

-- Escaping
select is(pg_temp.sorted_titles('p_employer => ''ac_e'''), '', 'an underscore is a character, not a wildcard');
select is(pg_temp.sorted_titles('p_employer => ''%%'''), '', 'a percent sign is a character, not a wildcard');
select is(pg_temp.sorted_titles('p_employer => ''0%_w'''), 'Pct vacancy', 'and a name that holds both is found by both');
select is(pg_temp.sorted_titles('p_employer => ''a\'''), '', 'a backslash is a character too, and an error of nobody');

-- Bounds
select is(pg_temp.search_ids('anon', null, 'p_employer => ''a'''), 'P0001|CHARA_INVALID_INPUT|p_employer', 'one character is refused');
select is(pg_temp.search_ids('anon', null, 'p_employer => '' a '''), 'P0001|CHARA_INVALID_INPUT|p_employer', 'one character after trimming is refused');
select is(pg_temp.search_ids('anon', null, format('p_employer => %L', repeat('a', 101))), 'P0001|CHARA_INVALID_INPUT|p_employer', '101 characters are refused');
select is(pg_temp.search_titles(format('p_employer => %L', repeat('a', 100))), '', '100 characters are accepted');
select isnt(pg_temp.search_titles('p_employer => ''ac'''), '', 'and so are 2');
select is(pg_temp.sorted_titles('p_employer => ''   '''), pg_temp.sorted_titles(), 'a blank value is no filter');
select is(pg_temp.sorted_titles('p_employer => null'), pg_temp.sorted_titles(), 'neither is null');

-- Pages
select pg_temp.seed_job(format('{"title": "Acme page %s", "status": "open"}', n)::jsonb) from generate_series(1, 3) n;
select pg_temp.page('p_employer => ''acme'', p_limit => 2') as p1 \gset
select is(jsonb_array_length(:'p1'::jsonb -> 'ids'), 2, 'a page of two of the vacancies of the employer');
select isnt(:'p1'::jsonb ->> 'cursor', null, 'has a cursor');
select is(
  jsonb_array_length((pg_temp.page(format('p_employer => ''acme'', p_limit => 2, p_cursor => %L', :'p1'::jsonb ->> 'cursor'))) -> 'ids'),
  2, 'the cursor leads to the next page of the same filter'
);

-- The index
select ok(
  exists (select 1 from pg_indexes where indexname = 'organizations_display_name_fold_trgm_idx'
          and indexdef ~ 'USING gin \(private\.fold_text\(display_name\) gin_trgm_ops\)'),
  'a trigram index on the folded display name serves the match'
);
select is(
  (select p.proargnames[13] from pg_proc p where p.oid = 'public.search_jobs(text, text, text, text, text, public.employment_type, numeric, text, public.salary_period, boolean, boolean, public.recruitment_preference, text, text, integer)'::regprocedure),
  'p_employer', 'p_employer follows p_recruitment'
);
select is(
  (select count(*) from pg_proc where proname = 'search_jobs' and pronamespace = 'public'::regnamespace), 1::bigint,
  'there is one search_jobs, so a call by name is never ambiguous'
);

select * from finish();
rollback;
