begin;
select plan(43);

\ir search_fixture.inc

-- The titles of a search as a sorted list, for the tests that check which vacancies match and not their order.
create function pg_temp.sorted_titles(p_args text default '') returns text
language sql as $$
  select coalesce(string_agg(t, ',' order by t), '')
  from unnest(string_to_array(nullif(pg_temp.search_titles(p_args), ''), ',')) t
$$;

-- FR-C3 AC2: the order is relevance, then newer first, then id; the plan has no effect.
insert into billing.subscriptions (organization_id, plan_code, status, provider) values
  (current_setting('t.a')::uuid, 'employer_starter', 'active', 'null'),
  (current_setting('t.b')::uuid, 'employer_enterprise', 'active', 'null');
select pg_temp.seed_job($j${
  "title": "Frame builder A", "status": "open", "created_at": "2026-01-01T10:00:00Z",
  "description": "We need welder welder welder welder welder for steel frames in our workshop."}$j$);
select pg_temp.seed_job($j${
  "title": "Frame builder", "status": "open", "created_at": "2026-01-02T10:00:00Z",
  "description": "We need one welder for the steel frames in our workshop in Hamburg."}$j$);
select pg_temp.seed_job($j${
  "title": "Frame builder", "status": "open", "created_at": "2026-01-03T10:00:00Z",
  "description": "We need one welder for the steel frames in our workshop in Hamburg."}$j$, current_setting('t.b')::uuid);
select pg_temp.seed_job($j${
  "title": "Frame builder D", "status": "open", "created_at": "2026-01-04T10:00:00Z",
  "description": "We need one pipe fitter for the steel frames in our workshop in Hamburg."}$j$);
select set_config('t.order_a', (select id::text from public.jobs where title = 'Frame builder A'), true);
select set_config('t.order_b', (select id::text from public.jobs where title = 'Frame builder' and organization_id = current_setting('t.a')::uuid), true);
select set_config('t.order_c', (select id::text from public.jobs where title = 'Frame builder' and organization_id = current_setting('t.b')::uuid), true);
select set_config('t.order_d', (select id::text from public.jobs where title = 'Frame builder D'), true);

select is(
  pg_temp.search_ids('anon', null, 'p_q => ''welder'''),
  concat_ws(',', current_setting('t.order_a'), current_setting('t.order_c'), current_setting('t.order_b')),
  'with a keyword the more relevant vacancy comes first, then the newer of two equal ones, and the one without the word is absent'
);
select is(
  pg_temp.search_ids('anon', null),
  concat_ws(',', current_setting('t.order_d'), current_setting('t.order_c'), current_setting('t.order_b'), current_setting('t.order_a')),
  'without a keyword the order is newest first'
);
update billing.subscriptions set plan_code = case organization_id
  when current_setting('t.a')::uuid then 'employer_enterprise' else 'employer_starter' end;
select is(
  pg_temp.search_ids('anon', null, 'p_q => ''welder'''),
  concat_ws(',', current_setting('t.order_a'), current_setting('t.order_c'), current_setting('t.order_b')),
  'swapping the plans of the two organisations does not change the order'
);

create temp table t_tie as
  select pg_temp.seed_job(format($j${
    "title": "Tie breaker %s", "status": "open", "created_at": "2026-02-01T10:00:00Z",
    "description": "We need one tiebreakword for the steel frames in our workshop in Hamburg."}$j$, n)::jsonb) as id
  from generate_series(1, 3) n;
select is(
  pg_temp.search_ids('anon', null, 'p_q => ''tiebreakword'''),
  (select string_agg(id::text, ',' order by id desc) from t_tie),
  'vacancies of equal relevance and creation time are ordered by id, largest first'
);
delete from public.jobs;

-- FR-C3 AC3: literal, accent-insensitive, whole-word matching.
select pg_temp.seed_job($j${
  "title": "Schweisser", "status": "open", "city": "München", "country_code": "DE",
  "description": "Wir suchen einen Muenchen und München erfahrenen Schweisser fuer die Werkstatt."}$j$);
select pg_temp.seed_job($j${"title": "Welder", "status": "open", "city": "Hamburg"}$j$);
select is(pg_temp.search_titles('p_q => ''munchen'''), 'Schweisser', 'a keyword without the accent finds the title with it');
select is(pg_temp.search_titles('p_q => ''MÜNCHEN'''), 'Schweisser', 'a keyword with a capital and the accent finds it too');
select is(pg_temp.search_titles('p_q => ''WELDER'''), 'Welder', 'the keyword is not case sensitive');
select is(pg_temp.search_titles('p_q => ''welders'''), '', 'there is no stemming: welders does not find welder');
select is(pg_temp.search_titles('p_q => ''welder hamburg'''), 'Welder', 'every word of the keyword must match');
select is(pg_temp.search_titles('p_q => ''welder schweisser'''), '', 'a word that matches no vacancy together with the others finds nothing');
select is(pg_temp.search_titles('p_q => ''elder'''), '', 'a part of a word does not match');
select is(pg_temp.search_titles('p_city => ''munchen'''), 'Schweisser', 'the city matches without the accent');
select is(pg_temp.search_titles('p_city => ''MUNCHEN'''), 'Schweisser', 'the city is not case sensitive');
select is(pg_temp.search_titles('p_city => ''Mün'''), '', 'the city matches as a whole value, not as a prefix');
select is(pg_temp.search_titles('p_city => ''  hamburg '''), 'Welder', 'the city is trimmed');
select is(pg_temp.search_titles('p_q => ''''''; drop table jobs; --'''), '', 'a hostile keyword matches nothing and raises nothing');
select is(pg_temp.search_titles('p_q => ''%'''), '', 'a percent sign in the keyword is literal');
select is(pg_temp.search_titles('p_city => ''%'''), '', 'a percent sign in the city is literal');
select is(pg_temp.search_titles('p_city => ''_'''), '', 'an underscore in the city is literal');
select is(pg_temp.search_titles('p_city => ''H_mburg'''), '', 'an underscore in the city is not a wildcard');
select is(pg_temp.search_titles(format('p_q => %L', repeat(chr(26085), 100))), '', 'a keyword of 100 non-Latin characters is accepted and matches nothing');
select is((select count(*) from public.jobs), 2::bigint, 'the vacancies are all still there after the hostile inputs');
delete from public.jobs;

-- FR-C3 AC4: each filter narrows, and the filters combine with AND.
create temp table t_seed (n int primary key, country text, city text, occupation text, industry text, employment text,
  accommodation boolean, visa boolean, recruitment text, scaffold boolean);
insert into t_seed values
  (1, 'DE', 'Hamburg', '7212', 'C', 'full_time', true, true, 'local', true),
  (2, 'DE', 'Berlin', '7212', 'C', 'part_time', false, true, 'both', false),
  (3, 'DE', 'Berlin', '7111', 'F', 'full_time', true, false, 'international', false),
  (4, 'DE', 'Hamburg', '7111', 'F', 'contract', false, false, 'local', true),
  (5, 'GB', 'London', '7212', 'C', 'full_time', true, true, 'international', false),
  (6, 'GB', 'London', '8332', 'H', 'temporary', false, false, 'both', true),
  (7, 'GB', 'Leeds', '8332', 'H', 'seasonal', true, false, 'local', false),
  (8, 'SE', 'Malmo', '7115', 'F', 'full_time', false, true, 'both', false),
  (9, 'SE', 'Malmo', '7115', 'C', 'part_time', true, true, 'international', false),
  (10, 'PL', 'Krakow', '5120', 'I', 'contract', false, false, 'local', false),
  (11, 'PL', 'Warsaw', '5120', 'I', 'full_time', true, true, 'both', false),
  (12, 'DE', 'Hamburg', '7212', 'C', 'full_time', true, true, 'international', true);
select pg_temp.seed_job(jsonb_build_object(
  'title', format('Vacancy %s', lpad(s.n::text, 2, '0')), 'status', 'open', 'country_code', s.country, 'city', s.city,
  'occupation_id', s.occupation, 'industry_code', s.industry, 'employment_type', s.employment,
  'accommodation', s.accommodation, 'visa_support', s.visa, 'recruitment_preference', s.recruitment,
  'created_at', '2026-03-01T10:00:00Z'::timestamptz + s.n * interval '1 hour',
  'description', case when s.scaffold then 'We need people who erect scaffold on building sites across the region.'
                      else 'We need people who work on building sites across the region, every day.' end
)) from t_seed s;

select is(pg_temp.sorted_titles(), 'Vacancy 01,Vacancy 02,Vacancy 03,Vacancy 04,Vacancy 05,Vacancy 06,Vacancy 07,Vacancy 08,Vacancy 09,Vacancy 10,Vacancy 11,Vacancy 12', 'no filter returns the twelve vacancies');
select is(pg_temp.sorted_titles('p_country => ''DE'''), 'Vacancy 01,Vacancy 02,Vacancy 03,Vacancy 04,Vacancy 12', 'the country filter');
select is(pg_temp.sorted_titles('p_country => ''de'''), 'Vacancy 01,Vacancy 02,Vacancy 03,Vacancy 04,Vacancy 12', 'the country filter takes lower case');
select is(pg_temp.sorted_titles('p_occupation => ''7212'''), 'Vacancy 01,Vacancy 02,Vacancy 05,Vacancy 12', 'the occupation filter');
select is(pg_temp.sorted_titles('p_industry => ''C'''), 'Vacancy 01,Vacancy 02,Vacancy 05,Vacancy 09,Vacancy 12', 'the industry filter');
select is(pg_temp.sorted_titles('p_employment_type => ''full_time'''), 'Vacancy 01,Vacancy 03,Vacancy 05,Vacancy 08,Vacancy 11,Vacancy 12', 'the employment type filter');
select is(pg_temp.sorted_titles('p_accommodation => true'), 'Vacancy 01,Vacancy 03,Vacancy 05,Vacancy 07,Vacancy 09,Vacancy 11,Vacancy 12', 'accommodation true selects the vacancies with accommodation');
select is(pg_temp.sorted_titles('p_visa_support => true'), 'Vacancy 01,Vacancy 02,Vacancy 05,Vacancy 08,Vacancy 09,Vacancy 11,Vacancy 12', 'visa support true selects the vacancies with visa support');
select is(
  pg_temp.sorted_titles('p_accommodation => false, p_visa_support => false'),
  'Vacancy 01,Vacancy 02,Vacancy 03,Vacancy 04,Vacancy 05,Vacancy 06,Vacancy 07,Vacancy 08,Vacancy 09,Vacancy 10,Vacancy 11,Vacancy 12',
  'false is not a filter'
);
select is(pg_temp.sorted_titles('p_recruitment => ''local'''), 'Vacancy 01,Vacancy 02,Vacancy 04,Vacancy 06,Vacancy 07,Vacancy 08,Vacancy 10,Vacancy 11', 'recruitment local returns local and both');
select is(pg_temp.sorted_titles('p_recruitment => ''international'''), 'Vacancy 02,Vacancy 03,Vacancy 05,Vacancy 06,Vacancy 08,Vacancy 09,Vacancy 11,Vacancy 12', 'recruitment international returns international and both');
select is(pg_temp.sorted_titles('p_country => ''XX'''), '', 'an unknown country returns nothing and raises nothing');
select is(
  pg_temp.search_titles('p_country => ''DE'', p_accommodation => true, p_q => ''scaffold'''), 'Vacancy 12,Vacancy 01',
  'filters combine with AND: the intersection of country, accommodation and keyword, newest first'
);
select is(pg_temp.sorted_titles('p_country => ''DE'', p_city => ''hamburg'', p_occupation => ''7212'', p_industry => ''C'', p_employment_type => ''full_time'', p_visa_support => true'), 'Vacancy 01,Vacancy 12', 'every kind of filter at once');

-- FR-C3 AC5: the minimum salary is matched against the top of the range, in the same currency and period.
delete from public.jobs;
select pg_temp.seed_job(format($j${"title": "Salary %s", "status": "open", %s}$j$, v.n, v.terms)::jsonb)
from (values
  (1, '"salary_min": 2000, "salary_max": 3000, "salary_currency": "EUR", "salary_period": "month"'),
  (2, '"salary_min": 2500, "salary_max": 3500, "salary_currency": "EUR", "salary_period": "month"'),
  (3, '"salary_min": 4000, "salary_max": null, "salary_currency": "EUR", "salary_period": "month"'),
  (4, '"salary_min": null, "salary_max": 3400, "salary_currency": "EUR", "salary_period": "month"'),
  (5, '"salary_min": 30000, "salary_max": 40000, "salary_currency": "EUR", "salary_period": "year"'),
  (6, '"salary_min": 3000, "salary_max": 5000, "salary_currency": "USD", "salary_period": "month"'),
  (7, '"salary_min": null')
) v (n, terms);

select is(
  pg_temp.sorted_titles('p_salary_min => 3000, p_salary_currency => ''EUR'', p_salary_period => ''month'''), 'Salary 1,Salary 2,Salary 4',
  'at 3000 a maximum of exactly 3000, 3500 and a vacancy with only a maximum of 3400 match; no maximum, another period, another currency and no salary do not'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 3001, p_salary_currency => ''EUR'', p_salary_period => ''month'''), 'Salary 2,Salary 4',
  'at 3001 only the maxima of 3500 and 3400 match'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 3000, p_salary_currency => ''USD'', p_salary_period => ''month'''), 'Salary 6',
  'the currency of the filter must equal that of the vacancy'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 3000, p_salary_currency => ''EUR'', p_salary_period => ''year'''), 'Salary 5',
  'the pay period of the filter must equal that of the vacancy'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 40000, p_salary_currency => ''EUR'', p_salary_period => ''year'''), 'Salary 5',
  'a maximum equal to the amount matches'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 1, p_salary_currency => ''EUR'', p_salary_period => ''hour'''), '',
  'no vacancy has an hourly salary, and nothing is converted'
);
select is(
  pg_temp.sorted_titles('p_salary_min => 3000, p_salary_currency => ''eur'', p_salary_period => ''month'''), 'Salary 1,Salary 2,Salary 4',
  'the currency code takes lower case'
);

select * from finish();
rollback;
