begin;
select plan(61);

\ir organizations_fixture.inc
\ir billing_events_fixture.inc

-- Boosts v1 (ARCHITECTURE.md sections 10.1, 10.5; OPEN_QUESTIONS.md C8, P11, R29): the products are seeded data, a boost
-- is bought by an owner or admin of a listed partner and created only by the webhook once the payment succeeded, a second
-- boost starts where the running one ends, the rail of a directory shows at most three boosted partners that match every
-- filter, and the organic order of search_partners does not move when a boost is inserted (paying is not ranking).

create function pg_temp.partner(
  p_owner uuid, p_type public.organization_type, p_slug text, p_id uuid, p_occupation text default '7212'
) returns uuid
language plpgsql as $$
begin
  insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country, review_status, listed_at,
    submitted_at, workforce_profile_updated_at)
  values (p_id, p_type, p_slug, 'Legal ' || p_slug || ' Ltd', initcap(replace(p_slug, '-', ' ')), 'PH', 'listed',
    now() - interval '30 days', now() - interval '31 days', '2026-10-01 08:00+00');
  insert into public.organization_members (organization_id, user_id, role, accepted_at) values (p_id, p_owner, 'owner', now());
  insert into public.organization_geographies (organization_id, scope, country_code)
  values (p_id, 'serves_market', 'DE'), (p_id, 'sources_from', 'PH');
  insert into public.organization_occupations (organization_id, occupation_id) values (p_id, p_occupation);
  insert into public.organization_languages (organization_id, language_code) values (p_id, 'tl');
  insert into public.organization_service_types (organization_id, service)
  select p_id, 'temporary' where p_type = 'staffing_company';
  insert into public.workforce_availability (organization_id, occupation_id, source_country, available, monthly_capacity,
    available_from, confirmed_at)
  values (p_id, p_occupation, 'PH', 120, 40, current_date, now() - interval '10 days');
  return p_id;
end;
$$;

-- A running boost of the partner, as the webhook leaves it.
create function pg_temp.boost(p_org uuid, p_sku text, p_starts interval default '-1 day', p_days integer default 7) returns void
language sql as $$
  insert into billing.boosts (organization_id, sku, target_type, target_id, starts_at, ends_at, provider, provider_payment_ref)
  values (p_org, p_sku, 'organization', p_org, now() + p_starts, now() + p_starts + make_interval(days => p_days), 'null',
    'pi_' || gen_random_uuid())
$$;

-- The slugs one search function call returns as the user (anonymous when null), in their order, with a fresh limit.
create function pg_temp.order_of(p_user uuid, p_call text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  delete from private.rate_limit_hits;
  perform set_config('t.result', '', true);
  v_result := pg_temp.call_as(p_user, case when p_user is null then 'anon' else 'authenticated' end,
    format('select set_config(''t.result'', coalesce((select string_agg(s.slug, '','' order by s.ordinality) from %s with ordinality s), ''''), true)', p_call),
    'aal1');
  return case when v_result = 'ok' then current_setting('t.result') else v_result end;
end;
$$;

create function pg_temp.directory(p_user uuid, p_args text) returns text
language sql as $$
  select pg_temp.order_of(p_user, format('public.search_partners(%s%s)', p_args,
    case when p_user is null then format(', p_key => %L', repeat('a', 64)) else '' end))
$$;

create function pg_temp.rail(p_user uuid, p_args text) returns text
language sql as $$ select pg_temp.order_of(p_user, format('public.boosted_partners(%s)', p_args)) $$;

-- The order the rail promises for this hour: a hash of the id and the hour, then the id.
create function pg_temp.rotation(p_slugs text[]) returns text
language sql as $$
  select string_agg(slug, ',' order by md5(id::text || to_char(date_trunc('hour', now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24')), id)
  from public.organizations where slug = any (p_slugs)
$$;

create function pg_temp.start(p_user uuid, p_org uuid, p_sku text, p_aal text default 'aal2') returns text
language sql as $$
  select pg_temp.call_as(p_user, 'authenticated',
    format('select * from public.billing_boost_checkout_start(%L, %L, %L)', p_org, p_sku, 'null'), p_aal)
$$;

create function pg_temp.boost_payload(p_org uuid, p_sku text, p_ref text, p_amount integer default 12971) returns jsonb
language sql as $$
  select jsonb_build_object('orgId', p_org, 'sku', p_sku, 'providerPaymentRef', p_ref, 'amountMinor', p_amount,
    'taxMinor', 2071, 'currency', 'EUR')
$$;

create function pg_temp.boosts(p_org uuid) returns text
language sql as $$
  select coalesce(string_agg(sku || ':' || extract(epoch from ends_at - starts_at)::integer / 86400, ',' order by starts_at), '')
  from billing.boosts where organization_id = p_org
$$;

-- Partners of earlier test data must not change the results below: they are hidden for this transaction.
update public.organizations set moderation_state = 'hidden' where type <> 'employer';
update private.settings set value = 'true' where key = 'release_partner_directories';

\set r1 '00000000-0000-0000-0000-0000b0057001'
\set r2 '00000000-0000-0000-0000-0000b0057002'
\set r3 '00000000-0000-0000-0000-0000b0057003'
\set r4 '00000000-0000-0000-0000-0000b0057004'
\set r5 '00000000-0000-0000-0000-0000b0057005'
\set cook '00000000-0000-0000-0000-0000b0057006'
\set s1 '00000000-0000-0000-0000-0000b0057101'
\set unlisted '00000000-0000-0000-0000-0000b0057201'
\set employer '00000000-0000-0000-0000-0000b0057301'

select pg_temp.partner(:'own2', 'recruitment_company', 'boost-r1', :'r1');
select pg_temp.partner(:'own2', 'recruitment_company', 'boost-r2', :'r2');
select pg_temp.partner(:'own2', 'recruitment_company', 'boost-r3', :'r3');
select pg_temp.partner(:'own2', 'recruitment_company', 'boost-r4', :'r4');
select pg_temp.partner(:'own1', 'recruitment_company', 'boost-r5', :'r5');
select pg_temp.partner(:'own2', 'recruitment_company', 'boost-cook', :'cook', '5120');
select pg_temp.partner(:'own2', 'staffing_company', 'boost-s1', :'s1');
select pg_temp.partner(:'own1', 'recruitment_company', 'boost-unlisted', :'unlisted');
update public.organizations set listed_at = null, review_status = 'pending_review' where id = :'unlisted';
select pg_temp.join_org(:'r5', :'adm', 'admin');
select pg_temp.join_org(:'r5', :'mem', 'member');
insert into public.organizations (id, type, slug, legal_name, display_name, based_in_country)
values (:'employer', 'employer', 'boost-employer', 'Boost Employer GmbH', 'Boost Employer', 'DE');
insert into public.organization_members (organization_id, user_id, role, accepted_at) values (:'employer', :'own1', 'owner', now());

\set welders 'boost-r1,boost-r2,boost-r3,boost-r4,boost-r5'

-- Products ------------------------------------------------------------------------------------------------------------
select is(
  (select string_agg(sku || ':' || org_type || ':' || days || ':' || price_minor || ':' || currency, ',' order by org_type, days)
   from billing.boost_products),
  'boost_recruitment_7d:recruitment_company:7:5900:EUR,boost_recruitment_14d:recruitment_company:14:10900:EUR,'
  || 'boost_recruitment_30d:recruitment_company:30:19900:EUR,boost_staffing_7d:staffing_company:7:4900:EUR,'
  || 'boost_staffing_14d:staffing_company:14:8900:EUR,boost_staffing_30d:staffing_company:30:13900:EUR',
  'C8: the six draft products are seeded, EUR minor units excl. VAT, one per partner type and duration'
);
select is(
  pg_temp.call_as(null, 'anon', $$select set_config('t.products', (select string_agg(sku, ',' order by org_type, days) from public.v_boost_products), true)$$)
  || ':' || current_setting('t.products'),
  'ok:boost_recruitment_7d,boost_recruitment_14d,boost_recruitment_30d,boost_staffing_7d,boost_staffing_14d,boost_staffing_30d',
  'a visitor reads the products on sale'
);
update billing.boost_products set sold = false where sku = 'boost_staffing_30d';
select is(
  pg_temp.val_as(:'mem', 'aal1', $$select count(*) from public.v_boost_products where org_type = 'staffing_company'$$), '2',
  'a product that is not sold is not listed'
);
select is_empty(
  $$select 1 from billing.plan_features where feature_key ~* 'boost' union all select 1 from billing.feature_keys where key ~* 'boost'$$,
  'a boost is not a plan feature'
);
select ok(
  not has_table_privilege('anon', 'billing.boosts', 'select')
  and not has_column_privilege('authenticated', 'billing.boosts', 'provider_payment_ref', 'select')
  and not has_table_privilege('authenticated', 'billing.boosts', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'billing.boost_products', 'insert, update, delete'),
  'nobody reads the payment reference of a boost or writes a boost or a product through the API'
);
select is(pg_get_userbyid((select relowner from pg_class where oid = 'billing.boosts'::regclass)), 'billing_owner',
  'billing_owner owns the boosts');

-- The checkout start: who may buy what ------------------------------------------------------------------------------------
select is(pg_temp.start(:'own1', :'r5', 'boost_recruitment_14d'), '42501|CHARA_FORBIDDEN|boosts_off',
  'release_boosts off: nobody starts a boost checkout');
update private.settings set value = 'true' where key = 'release_boosts';
select is(pg_temp.start(:'mem', :'r5', 'boost_recruitment_14d'), 'P0001|CHARA_FORBIDDEN|', 'a member cannot buy a boost');
select is(pg_temp.start(:'oth', :'r5', 'boost_recruitment_14d'), 'P0001|CHARA_FORBIDDEN|', 'an outsider cannot buy a boost');
select is(pg_temp.start(:'own1', :'r5', 'boost_recruitment_14d', 'aal1'), 'P0001|CHARA_FORBIDDEN|aal2_required',
  'the owner needs the second step');
select is(pg_temp.start(:'wkr', :'r5', 'boost_recruitment_14d'), 'P0001|CHARA_FORBIDDEN|worker_account',
  'a worker never pays');
select is(pg_temp.start(:'own1', :'r5', 'boost_gold'), '42501|CHARA_FORBIDDEN|unknown_product', 'an unknown product is refused');
select is(pg_temp.start(:'own1', :'r5', 'boost_staffing_7d'), '42501|CHARA_FORBIDDEN|product_not_for_org_type',
  'a product of the other partner type is refused');
update billing.boost_products set sold = false where sku = 'boost_recruitment_30d';
select is(pg_temp.start(:'own1', :'r5', 'boost_recruitment_30d'), '42501|CHARA_FORBIDDEN|product_not_sold',
  'a product that is not sold is refused');
update billing.boost_products set sold = true where sku = 'boost_recruitment_30d';
select is(pg_temp.start(:'own1', :'unlisted', 'boost_recruitment_7d'), '42501|CHARA_FORBIDDEN|not_listed',
  'a partner that is not listed cannot buy a boost');
select is(pg_temp.start(:'own1', :'employer', 'boost_recruitment_7d'), '42501|CHARA_FORBIDDEN|product_not_for_org_type',
  'an employer cannot buy a partner boost');
select is(pg_temp.start(:'own1', :'r5', 'boost_recruitment_14d'), 'ok', 'the owner at aal2 starts the checkout');
select is(
  pg_temp.val_as(:'adm', 'aal2', format($$select format('%%s|%%s|%%s|%%s|%%s', slug, coalesce(customer_ref, '-'), amount_minor, currency, days)
    from public.billing_boost_checkout_start(%L, 'boost_recruitment_14d', 'null')$$, :'r5')),
  'boost-r5|-|10900|EUR|14', 'an admin starts it too and gets the amount, the currency and the days of the product'
);
select is(
  (select count(*) from audit.log where action = 'billing.boost_checkout_started' and entity_id = :'r5' and metadata ->> 'sku' = 'boost_recruitment_14d'),
  2::bigint, 'each start is audited with the product'
);
select is(pg_temp.boosts(:'r5'), '', 'starting a checkout creates no boost: only a paid event does');

-- The webhook ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.deliver('boost_1', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_recruitment_14d', 'pi_boost_1')), 'applied',
  'a paid boost event is applied');
select is(pg_temp.boosts(:'r5'), 'boost_recruitment_14d:14', 'it creates exactly one boost of 14 days');
select ok(
  (select starts_at = now() and target_type = 'organization' and target_id = :'r5' and provider_payment_ref = 'pi_boost_1'
   from billing.boosts where organization_id = :'r5'),
  'the boost starts when the payment is applied, for the profile of the organisation, under the payment reference'
);
select is(
  (select format('%s|%s|%s|%s|%s', kind, sku_or_plan, amount_minor, tax_minor, currency) from billing.orders
   where organization_id = :'r5'),
  'boost|boost_recruitment_14d|12971|2071|EUR', 'and one order with the amount and the tax the provider charged'
);
select is(pg_temp.deliver('boost_1', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_recruitment_14d', 'pi_boost_1')), 'applied',
  'the same event delivered again answers applied');
select is(pg_temp.deliver('boost_1_async', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_recruitment_14d', 'pi_boost_1')),
  'applied', 'another event for the same payment is applied');
select is(
  pg_temp.boosts(:'r5') || '|' || (select count(*) from billing.orders where organization_id = :'r5'),
  'boost_recruitment_14d:14|1', 'and neither creates a second boost or order'
);
select is(pg_temp.deliver('boost_2', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_recruitment_7d', 'pi_boost_2', 6900)), 'applied',
  'a second boost bought while the first runs is applied');
select is(pg_temp.boosts(:'r5'), 'boost_recruitment_14d:14,boost_recruitment_7d:7', 'it is a boost of its own days');
select ok(
  (select b2.starts_at = b1.ends_at and b2.ends_at = b1.ends_at + interval '7 days'
   from billing.boosts b1, billing.boosts b2
   where b1.provider_payment_ref = 'pi_boost_1' and b2.provider_payment_ref = 'pi_boost_2'),
  'the extension starts where the running boost ends'
);
select is(pg_temp.applied_audit(:'r5'), 3::bigint, 'each applied event is audited once');

select pg_temp.alerts('billing_event_error') as alerts_before \gset
select is(pg_temp.deliver('boost_unknown', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_gold', 'pi_boost_3')), 'error',
  'an unknown product is an error');
select is(pg_temp.event_status('boost_unknown'), 'error/unknown_product', 'with the reason unknown_product');
select is(pg_temp.deliver('boost_other_type', 'boost.paid', pg_temp.boost_payload(:'r5', 'boost_staffing_7d', 'pi_boost_4')), 'error',
  'a product of the other partner type is an error');
select is(pg_temp.event_status('boost_other_type'), 'error/org_mismatch', 'with the reason org_mismatch');
select is(pg_temp.deliver('boost_employer', 'boost.paid', pg_temp.boost_payload(:'employer', 'boost_recruitment_7d', 'pi_boost_5')), 'error',
  'a boost paid for an employer is an error');
select is(
  pg_temp.boosts(:'r5') || '|' || pg_temp.boosts(:'employer') || '|' || (select count(*) from billing.orders where provider_ref in ('pi_boost_3', 'pi_boost_4', 'pi_boost_5')),
  'boost_recruitment_14d:14,boost_recruitment_7d:7||0', 'no error creates a boost or an order'
);
select is(pg_temp.alerts('billing_event_error'), :'alerts_before'::bigint + 3, 'each error raises one alert');

-- Who reads the boosts -----------------------------------------------------------------------------------------------------
select is(pg_temp.val_as(:'mem', 'aal1', format('select count(*) from public.v_active_boosts where organization_id = %L', :'r5')), '2',
  'a member reads the running boost and the one that follows it');
select is(pg_temp.val_as(:'oth', 'aal1', 'select count(*) from public.v_active_boosts'), '0', 'an outsider reads no boost');
select matches(pg_temp.call_as(null, 'anon', 'select * from public.v_active_boosts'), '^42501\|permission denied',
  'a visitor cannot read the boosts');
select matches(pg_temp.call_as(:'mem', 'authenticated', 'select provider_payment_ref from billing.boosts', 'aal2'), '^42501\|permission denied',
  'a member cannot read the payment reference');

-- The organic order does not move ---------------------------------------------------------------------------------------------
delete from billing.boosts;
select is(pg_temp.directory(null, '''recruitment'', p_occupation => ''7212'''), :'welders',
  'the welders in id order, before any boost');
select pg_temp.boost(:'r5', 'boost_recruitment_30d');
select pg_temp.boost(:'r4', 'boost_recruitment_30d');
select is(pg_temp.directory(null, '''recruitment'', p_occupation => ''7212'''), :'welders',
  'NFR-C8: the same order once the last two have a running boost');
select is(pg_temp.directory(:'oth', '''recruitment'', p_occupation => ''7212'', p_destination => ''DE'', p_language => ''tl'''), :'welders',
  'NFR-C8: and with filters, for a signed-in user');
select ok(
  (select bool_and(prosrc !~* '\m(billing|boosts?|boost_products)\M') from pg_proc
   where proname in ('search_partners', 'search_available_workforce', 'suggest_partners') and pronamespace = 'public'::regnamespace),
  'NFR-C8: no search function names billing or a boost'
);

-- The rail ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'''), pg_temp.rotation(array['boost-r4', 'boost-r5']),
  'a visitor sees the two boosted welders in the rail, in the order of the hour');
select pg_temp.boost(:'r1', 'boost_recruitment_7d');
select pg_temp.boost(:'r2', 'boost_recruitment_7d');
select pg_temp.boost(:'r3', 'boost_recruitment_7d');
select pg_temp.boost(:'cook', 'boost_recruitment_7d');
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'''),
  (select string_agg(s, ',') from (select unnest(string_to_array(pg_temp.rotation(string_to_array(:'welders', ',')), ',')) s limit 3) t),
  'at most three of the five boosted welders, the first three of the order of the hour');
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''5120'''), 'boost-cook',
  'a search for cooks shows the boosted cook agency and no welding agency');
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'', p_language => ''de'''), '',
  'a filter that no boosted partner matches leaves the rail empty');
select is(pg_temp.directory(null, '''recruitment'', p_occupation => ''7212'', p_language => ''de'''), :'welders',
  'while the organic results still list the partners that match the other filters');
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'', p_based_in => ''DE'''), '',
  'every filter is required: a partner based elsewhere is not in the rail');
select is(pg_temp.rail(null, '''staffing'''), '', 'a recruitment boost is not shown in the staffing directory');
select pg_temp.boost(:'s1', 'boost_staffing_7d');
select is(pg_temp.rail(null, '''staffing'', p_staffing_types => ''{temporary}'''), 'boost-s1', 'a staffing boost is');
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'', p_capacity => 100'), '',
  'an advanced filter a visitor may not use gives an empty rail');
update billing.boosts set starts_at = now() + interval '1 day', ends_at = now() + interval '8 days' where organization_id = :'cook';
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''5120'''), '', 'a boost that has not started is not shown');
update billing.boosts set starts_at = now() - interval '8 days', ends_at = now() - interval '1 day' where organization_id = :'cook';
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''5120'''), '', 'nor one that has ended');
update public.organizations set moderation_state = 'hidden' where id = :'s1';
select is(pg_temp.rail(null, '''staffing'''), '', 'a hidden partner is not shown, whatever it paid');
update private.settings set value = 'false' where key = 'release_boosts';
select is(pg_temp.rail(null, '''recruitment'', p_occupation => ''7212'''), '', 'release_boosts off: the rail is empty');

-- Paying is not verified ---------------------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c where c.relkind in ('r', 'p', 'v', 'm') and c.relname ~ '^verification'
     and has_table_privilege('billing_owner', c.oid, 'select, insert, update, delete')),
  0::bigint, 'billing_owner still has no privilege on a verification table'
);
select ok(
  not exists (select 1 from pg_proc p where p.pronamespace = 'billing'::regnamespace and p.prosrc ~* 'verification')
  and (select prosrc !~* 'verification' from pg_proc where oid = 'public.billing_apply_event(uuid)'::regprocedure),
  'no billing function, the boost one included, refers to a verification table'
);

select * from finish();
rollback;
