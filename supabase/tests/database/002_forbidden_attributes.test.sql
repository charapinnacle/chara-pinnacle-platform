begin;
select plan(3);

create function pg_temp.forbidden_columns() returns setof text
language sql as $$
  select format('%s.%s.%s', table_schema, table_name, column_name)
  from information_schema.columns
  where table_schema in ('public', 'private', 'audit', 'stats', 'billing')
    and regexp_replace(lower(column_name), '[^a-z0-9]+', '_', 'g') ~ any (array[
      '(^|_)id_?number(_|$)',
      'national_?id',
      'passport_?number',
      'date_?of_?birth',
      'birth_?date',
      'birthday',
      '(^|_)dob(_|$)',
      'nationality',
      'religion',
      'gender',
      'marital'
    ])
  order by 1
$$;

select is_empty(
  $$select * from pg_temp.forbidden_columns()$$,
  'no column holds an ID number, date of birth, nationality, religion, gender or marital status'
);

create table public.forbidden_probe (
  id_number text,
  "National ID" text,
  passport_number text,
  date_of_birth date,
  dob date,
  birthdate date,
  nationality text,
  religion text,
  gender text,
  marital_status text,
  display_name text,
  identifier text,
  adobe_license text
);

select set_eq(
  $$select * from pg_temp.forbidden_columns()$$,
  $$values
    ('public.forbidden_probe.birthdate'),
    ('public.forbidden_probe.date_of_birth'),
    ('public.forbidden_probe.dob'),
    ('public.forbidden_probe.gender'),
    ('public.forbidden_probe.id_number'),
    ('public.forbidden_probe.marital_status'),
    ('public.forbidden_probe.nationality'),
    ('public.forbidden_probe.passport_number'),
    ('public.forbidden_probe.religion'),
    ('public.forbidden_probe.National ID')$$,
  'detector: every forbidden column name, in any spelling, is reported and nothing else'
);

alter table public.forbidden_probe rename column nationality to work_authorization_country;

select set_eq(
  $$select * from pg_temp.forbidden_columns()$$,
  $$values
    ('public.forbidden_probe.birthdate'),
    ('public.forbidden_probe.date_of_birth'),
    ('public.forbidden_probe.dob'),
    ('public.forbidden_probe.gender'),
    ('public.forbidden_probe.id_number'),
    ('public.forbidden_probe.marital_status'),
    ('public.forbidden_probe.passport_number'),
    ('public.forbidden_probe.religion'),
    ('public.forbidden_probe.National ID')$$,
  'detector: a column renamed to work_authorization_country is no longer reported'
);

select * from finish();
rollback;
