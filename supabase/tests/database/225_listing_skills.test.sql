-- The skills of an availability listing (FR-K3): optional columns, set by set_listing_skills with the checks of the other
-- listing functions, and returned with the listing on the partner profile and in the available workforce search.
begin;
select plan(9);

select columns_are('public', 'workforce_availability', array[
  'id', 'organization_id', 'occupation_id', 'source_country', 'source_scope', 'available', 'monthly_capacity',
  'available_from', 'confirmed_at', 'reminded_at', 'created_by', 'created_at', 'updated_at',
  'language_code', 'language_level', 'min_experience_years', 'certificates'
], 'a listing carries the four optional skills');
select ok(
  (select bool_and(not attnotnull) from pg_attribute
   where attrelid = 'public.workforce_availability'::regclass
     and attname in ('language_code', 'language_level', 'min_experience_years', 'certificates')),
  'every skill is optional'
);
select ok(
  (select bool_and(has_column_privilege('authenticated', 'public.workforce_availability', c, 'select'))
   from unnest(array['language_code', 'language_level', 'min_experience_years', 'certificates']) c),
  'members read the skills of their own listings like the other columns'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.workforce_availability'::regclass
    and conname = 'workforce_availability_level_needs_language'),
  'a level needs its language'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] and prosrc ~ 'assert_listing_manager' from pg_proc
   where oid = 'public.set_listing_skills(uuid, text, text, integer, text)'::regprocedure),
  'set_listing_skills is security definer with an empty search_path and the checks of the listing functions'
);
select ok(
  has_function_privilege('authenticated', 'public.set_listing_skills(uuid, text, text, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_listing_skills(uuid, text, text, integer, text)', 'execute'),
  'only signed-in users may call it'
);
select ok(
  (select prosrc ~ '''certificates''' and prosrc ~ '''language_level''' from pg_proc
   where oid = 'private.partner_profile(uuid)'::regprocedure),
  'the partner profile returns the skills of each listing'
);
select ok(
  (select prosrc ~ '''certificates''' and prosrc ~ 'workforce_band' from pg_proc
   where proname = 'search_available_workforce' and pronamespace = 'public'::regnamespace),
  'the available workforce search returns the skills with the ranges'
);
select is(
  (select count(*)::integer from pg_proc where proname = 'search_available_workforce' and pronamespace = 'public'::regnamespace),
  1,
  'one available workforce search remains'
);

select * from finish();
rollback;
