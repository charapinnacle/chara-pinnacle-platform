-- The skills and fee terms beside a partner's response (public.response_terms): read under the policy of the responses,
-- written only through set_response_terms with the checks of update_response.
begin;
select plan(9);

select has_table('public', 'response_terms', 'the response terms table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.response_terms'::regclass),
  'row level security is on and forced'
);
select ok(
  has_table_privilege('authenticated', 'public.response_terms', 'select')
  and not has_table_privilege('anon', 'public.response_terms', 'select'),
  'signed-in users read terms (under the policy), visitors never'
);
select is_empty(
  $$
    select r.rolname, p.priv
    from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
    cross join unnest(array['insert', 'update', 'delete', 'truncate']) as p(priv)
    where has_table_privilege(r.rolname, 'public.response_terms', p.priv)
  $$,
  'no API role writes the table directly'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ~ 'partner_responses' from pg_policy where polrelid = 'public.response_terms'::regclass
     and polname = 'response_terms_select'),
  'the read policy goes through the responses the caller may read'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)'::regprocedure),
  'set_response_terms is security definer with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)', 'execute'),
  'only signed-in users may call set_response_terms'
);
select ok(
  (select prosrc ~ 'assert_responding_partner' and prosrc ~ 'requirement_closed' and prosrc ~ 'hidden' from pg_proc
   where oid = 'public.set_response_terms(uuid, uuid, text, text, integer, text, text[], integer, integer)'::regprocedure),
  'it checks the responding partner, a hidden response and a closed requirement, as update_response does'
);
select ok(
  (select pg_get_constraintdef(oid) ~ 'trade_test' and pg_get_constraintdef(oid) ~ 'insurance' from pg_constraint
   where conrelid = 'public.response_terms'::regclass and pg_get_constraintdef(oid) ~ 'fee_includes'),
  'the fee inclusions are limited to the list the form offers'
);

select * from finish();
rollback;
