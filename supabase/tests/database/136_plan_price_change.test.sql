begin;
select plan(34);

\ir status_fixture.inc

-- A plan price change (V17, FR-R2 AC8 database side, AC9; SOP FR-R2 step Price and output "New provider prices", controls
-- role, two-step, range, reason, audit with old values and no change to existing subscription prices; NFR-O5, NFR-S8).
-- admin_get_plan_price is the read billing-plan-price makes with the caller's token before it calls the provider;
-- admin_record_plan_price records the provider's new price with one combined audit row.

\set reason 'Price review after the first quarter'
\set gone_admin '00000000-0000-0000-0000-00000000b701'
\set r_owner '00000000-0000-0000-0000-00000000b702'
\set q_owner '00000000-0000-0000-0000-00000000b703'

select pg_temp.new_user(:'gone_admin');
update public.profiles set account_kind = intended_account_kind where id = :'gone_admin';
insert into public.platform_staff (user_id, role, revoked_at) values (:'gone_admin', 'admin', now());
update private.settings set value = 'true' where key = 'release_partner_directories';

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select u.id, u.id || '@partner.test', now(), jsonb_build_object('intended_account_kind', 'company', 'intended_organization_type', 'recruitment_company')
from (values (:'r_owner'::uuid), (:'q_owner'::uuid)) u (id);
update public.profiles set account_kind = intended_account_kind where id in (:'r_owner', :'q_owner');

create function pg_temp.partner(p_owner uuid, p_identifier text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, legal_entity_identifier,
    legal_entity_identifier_kind)
  values (v_id, 'recruitment_company', 'org-' || left(v_id::text, 8), 'Partner ' || left(v_id::text, 8),
    'Partner ' || left(v_id::text, 8), 'DE', p_identifier, 'registration_number');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (v_id, p_owner, 'owner', now());
  return v_id;
end;
$$;

create function pg_temp.admin(p_sql text, p_user uuid default '00000000-0000-0000-0000-00000000a021', p_aal text default 'aal2') returns text
language sql as $$ select pg_temp.call_as(p_user, 'authenticated', p_sql, p_aal) $$;

create function pg_temp.record(p_code text, p_ref text, p_price integer, p_reason text default 'Price review after the first quarter') returns text
language sql as $$
  select pg_temp.admin(format('select public.admin_record_plan_price(%L, %L, %s, %L)', p_code, p_ref, coalesce(p_price::text, 'null'), p_reason))
$$;

-- Everything a price change can write, to compare before and after a refused call.
create function pg_temp.state() returns text
language sql as $$
  select (select count(*) from audit.log) || '|' || (select md5(string_agg(to_jsonb(p)::text, ',' order by code)) from billing.plans p)
      || '|' || (select coalesce(md5(string_agg(to_jsonb(r)::text, ',' order by plan_code, provider)), '') from billing.plan_provider_refs r)
      || '|' || (select md5(string_agg(to_jsonb(s)::text, ',' order by organization_id)) from billing.subscriptions s)
$$;

select pg_temp.partner(:'r_owner', 'HRB10001') as r \gset
select pg_temp.partner(:'q_owner', 'HRB10002') as q \gset
insert into billing.subscriptions (organization_id, plan_code, status, provider, provider_subscription_ref)
values (:'r', 'recruitment_partner', 'active', 'stripe', 'sub_r_4900');
insert into billing.plan_provider_refs (plan_code, provider, provider_product_ref, provider_price_ref) values
  ('recruitment_partner', 'stripe', 'prod_rp', 'price_rp_4900'),
  ('recruitment_professional', 'stripe', 'prod_rpro', null);

-- Only an active Platform Administrator at aal2 -----------------------------------------------------------------------
create temp table calls (fn text primary key, sql text not null);
insert into calls values
  ('admin_get_plan_price', $$select * from public.admin_get_plan_price('recruitment_partner')$$),
  ('admin_record_plan_price', $$select public.admin_record_plan_price('recruitment_partner', 'price_rp_5400', 5400, 'Matrix call reason')$$);
create temp table callers (label text primary key, uid uuid, aal text, expected text);
insert into callers values
  ('admin at aal1', :'st_admin', 'aal1', 'P0001|CHARA_FORBIDDEN|aal2_required'),
  ('revoked admin', :'gone_admin', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('trust and safety', :'st_trust', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('verification reviewer', :'st_review', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('employer owner', :'own1', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('partner owner', :'r_owner', 'aal2', 'P0001|CHARA_FORBIDDEN|'),
  ('candidate', '00000000-0000-0000-0000-00000000a101', 'aal2', 'P0001|CHARA_FORBIDDEN|');
select pg_temp.state() as before_matrix \gset
select is_empty(
  $$select c.label, f.fn from callers c cross join calls f
    where pg_temp.call_as(c.uid, 'authenticated', f.sql, c.aal) <> c.expected$$,
  'aal1 gets aal2_required; a revoked administrator, T&S, a reviewer, owners and a candidate get CHARA_FORBIDDEN, for both functions'
);
select is(
  (select count(*) from calls f where pg_temp.call_as(null, 'anon', f.sql) ~ '^42501\|permission denied for function'), 2::bigint,
  'the anonymous caller lacks EXECUTE on both'
);
select is(
  (select count(*) from calls f where not has_function_privilege('anon', (
     select p.oid from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace), 'execute')
     and not has_function_privilege('service_role', (
     select p.oid from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace), 'execute')
     and has_function_privilege('authenticated', (
     select p.oid from pg_proc p where p.proname = f.fn and p.pronamespace = 'public'::regnamespace), 'execute')), 2::bigint,
  'EXECUTE is granted to authenticated only'
);
select is(
  pg_temp.call_as(:'r_owner', 'authenticated', $$update billing.plan_provider_refs set provider_price_ref = 'price_cheap'$$),
  '42501|permission denied for table plan_provider_refs|', 'NFR-S8: a direct write to the provider references is refused'
);
select is(
  pg_temp.call_as(:'r_owner', 'authenticated', $$select * from billing.plan_provider_refs$$),
  '42501|permission denied for table plan_provider_refs|', 'NFR-S8: the provider references are not readable by an API role'
);
select is(pg_temp.state(), :'before_matrix', 'no row changed and no audit row was written by a refused caller');

-- The read the function makes before calling the provider -------------------------------------------------------------
select is(
  pg_temp.json_as(:'st_admin', $$select * from public.admin_get_plan_price('recruitment_partner')$$, 'aal2') -> 0,
  '{"code": "recruitment_partner", "name": "Basic", "interval": "month", "currency": "EUR", "org_type": "recruitment_company", "price_ref": "price_rp_4900", "product_ref": "prod_rp", "price_minor": 4900}'::jsonb,
  'the administrator reads the plan''s amount, currency, interval, product and current price at the provider'
);
select is(
  (pg_temp.json_as(:'st_admin', $$select product_ref, price_ref from public.admin_get_plan_price('staffing_partner')$$, 'aal2') -> 0)::text,
  '{"price_ref": null, "product_ref": null}', 'a plan the sync script has not mirrored has no product and no price'
);
select is(
  pg_temp.admin($$select * from public.admin_get_plan_price('recruitment_gold')$$),
  'P0001|CHARA_INVALID_INPUT|plan_code', 'an unknown plan names the field'
);

-- Values, references and reasons are validated; a refusal writes nothing ---------------------------------------------
select pg_temp.state() as before_invalid \gset
select is(pg_temp.record('recruitment_partner', 'price_rp_x', 99), 'P0001|CHARA_INVALID_INPUT|price_minor', 'a price below 100 is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_x', 10000001), 'P0001|CHARA_INVALID_INPUT|price_minor', 'a price above 10,000,000 is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_x', null), 'P0001|CHARA_INVALID_INPUT|price_minor', 'a missing price is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_x', 4900), 'P0001|CHARA_INVALID_INPUT|price_unchanged', 'the current price is refused');
select is(pg_temp.record('free_recruitment_company', 'price_rp_x', 900), 'P0001|CHARA_INVALID_INPUT|free_plan', 'a free plan stays free');
select is(pg_temp.record('recruitment_gold', 'price_rp_x', 900), 'P0001|CHARA_INVALID_INPUT|plan_code', 'an unknown plan is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_x', 5400, 'too short'), 'P0001|CHARA_INVALID_INPUT|reason', 'a 9-character reason is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_x', 5400, repeat('r', 501)), 'P0001|CHARA_INVALID_INPUT|reason', 'a 501-character reason is refused');
select is(pg_temp.record('recruitment_partner', 'prod_rp', 5400), 'P0001|CHARA_INVALID_INPUT|price_ref', 'a reference that is not a price is refused');
select is(pg_temp.record('recruitment_partner', 'price_rp_4900', 5400), 'P0001|CHARA_INVALID_INPUT|price_ref', 'the current price reference is refused');
select is(pg_temp.record('recruitment_partner', null, 5400), 'P0001|CHARA_INVALID_INPUT|price_ref',
  'a plan whose price is held at the provider changes only with a new provider price');
select is(pg_temp.record('staffing_partner', 'price_sp_6400', 6400), 'P0001|CHARA_UNAVAILABLE|plan_not_synced',
  'a provider price cannot be recorded for a plan without a product at the provider');
select is(pg_temp.state(), :'before_invalid', 'no refused call changed a row or wrote an audit row');

-- AC9: the change applies to new checkouts and existing subscriptions keep their price ------------------------------
select md5(to_jsonb(s)::text) as r_subscription from billing.subscriptions s where s.organization_id = :'r' \gset
select coalesce(max(id), 0) as base from audit.log \gset
select is(pg_temp.record('recruitment_partner', 'price_rp_5400', 5400, :'reason'), 'ok', 'AC9: the administrator records the new price');
select is(
  (select format('%s|%s', p.price_minor, r.provider_price_ref) from billing.plans p
   join billing.plan_provider_refs r on r.plan_code = p.code and r.provider = 'stripe' where p.code = 'recruitment_partner'),
  '5400|price_rp_5400', 'AC9: plans.price_minor is 5400 and plan_provider_refs holds the new price reference'
);
select is(
  (select md5(to_jsonb(s)::text) from billing.subscriptions s where s.organization_id = :'r'), :'r_subscription',
  'AC9: R''s subscription row is unchanged'
);
select is(
  pg_temp.call_as(:'q_owner', 'authenticated', format(
    $f$select set_config('t.out', (select price_ref from public.billing_checkout_start(%L, 'recruitment_partner', 'DE', null, 'HRB10002', %s, 'stripe')), true)$f$,
    :'q', private.current_legal_version('subscription-and-billing-terms'))) || ':' || current_setting('t.out', true),
  'ok:price_rp_5400', 'AC9: a checkout started by Q after the change uses the new price reference'
);
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s|%s', count(*), max(action), max(actor_id::text), max(entity_type), max(entity_id),
     max(metadata ->> 'table'), max((metadata -> 'before')::text), max((metadata -> 'after')::text), max(metadata ->> 'reason'))
   from audit.log where id > :base and action = 'billing.plan_changed'),
  format('1|billing.plan_changed|%s|plan|recruitment_partner|plans|{"price_minor": 4900, "provider_price_ref": "price_rp_4900"}|{"price_minor": 5400, "provider_price_ref": "price_rp_5400"}|%s',
    :'st_admin', :'reason'),
  'AC9: one audit row records the old and new price, both price references, the administrator and the reason'
);
select is(
  (pg_temp.json_as(:'st_admin', $$select table_name, reason from public.admin_list_plan_history('recruitment_partner') limit 1$$, 'aal2') -> 0)::text,
  format('{"reason": "%s", "table_name": "plans"}', :'reason'), 'the price change is the newest entry of the plan history'
);

-- The suppression lasts only for the two writes of the price change -------------------------------------------------
select is(current_setting('chara.billing_audit_suppress', true), 'off', 'the suppression is reset right after the price writes');
select is(current_setting('chara.audit_reason', true), '', 'the statement of reasons is reset after the call');
select coalesce(max(id), 0) as base from audit.log \gset
select is(
  pg_temp.admin(format($$select public.admin_set_plan_limit('recruitment_partner', 'markets', 4, %L)$$, :'reason')), 'ok',
  'a limit change in the same transaction'
);
update billing.plan_provider_refs set provider_product_ref = 'prod_rp_renamed' where plan_code = 'recruitment_partner';
select is(
  (select string_agg(metadata ->> 'table', ',' order by id) from audit.log where id > :base and action = 'billing.plan_changed'),
  'plan_limits,plan_provider_refs', 'later billing writes in the same transaction are audited again by their row triggers'
);

-- The null provider holds no prices: a plan without a provider price changes its amount alone -----------------------
select coalesce(max(id), 0) as base from audit.log \gset
select is(pg_temp.record('staffing_partner', null, 6400, :'reason'), 'ok', 'without a provider the amount is recorded alone');
select is(
  (select format('%s|%s|%s', (select price_minor from billing.plans where code = 'staffing_partner'), count(*), max((metadata -> 'after')::text))
   from audit.log where id > :base),
  '6400|1|{"price_minor": 6400, "provider_price_ref": null}', 'one audit row; no provider reference was invented'
);

select * from finish();
rollback;
