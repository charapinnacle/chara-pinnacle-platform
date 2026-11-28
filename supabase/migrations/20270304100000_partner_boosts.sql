-- Boosts v1: paid visibility for the profile of a recruitment or staffing company (ARCHITECTURE.md sections 10.1, 10.5;
-- OPEN_QUESTIONS.md C8, P11, R29). A listed partner buys a boost of its own type with a one-time payment; the boost
-- exists only once the payment provider says the payment succeeded (billing_apply_event, kind boost.paid), and a boost
-- bought while another is running starts where that one ends. A boosted partner is shown in a rail of its own above the
-- organic results of its directory, labelled Boosted, and only while it matches every filter of the search:
-- search_partners reads no billing table, so paying never changes the order of the results (NFR-C8). Subscription,
-- Verification and Boost stay three separate systems: nothing here reads or writes a trust table. Everything answers
-- only while release_boosts is on (false by default). Job and company boosts, refunds and administrator editing of the
-- products are later.

-- Settings -------------------------------------------------------------------------------------------------------------

insert into private.settings (key, value) values ('release_boosts', 'false');

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('release_boosts', 'boolean', null, null, 'Boosts: partners buy paid visibility in the partner directories', null);

-- get_public_settings of 20270216200200_contact_request_public_periods.sql with release_boosts, so the directories, the
-- boost page and the workforce profile follow it.
create or replace function public.get_public_settings() returns table (key text, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.value #>> '{}'
  from private.settings s
  where s.key = any (array[
    'legal_entity_name', 'legal_entity_address', 'legal_entity_registration_number', 'legal_entity_vat_id',
    'legal_entity_email', 'privacy_contact', 'data_protection_contact', 'release_partner_directories',
    'partner_review_target_working_days', 'licence_number_patterns', 'licence_valid_until_max_years',
    'workforce_listing_stale_days', 'workforce_confirm_reminder_days', 'workforce_available_from_max_days',
    'release_job_orders', 'release_candidate_submissions', 'release_messaging', 'release_find_workers',
    'release_data_export', 'requirement_open_days', 'requirement_extension_days', 'requirement_closing_reminder_days',
    'response_documents_max', 'message_body_max_chars', 'contact_request_repeat_days', 'contact_request_decline_days',
    'contact_request_expiry_days', 'release_boosts'
  ])
$$;

-- Tables ---------------------------------------------------------------------------------------------------------------

-- The products are data (C8: the prices are drafts until the owner confirms them). EUR, exclusive of VAT, as the plans.
create table billing.boost_products (
  sku text primary key check (sku ~ '^[a-z0-9_]{1,64}$'),
  target_type text not null check (target_type in ('job', 'organization')),
  org_type public.organization_type not null,
  days integer not null check (days between 1 and 365),
  price_minor integer not null check (price_minor > 0),
  currency text not null references public.currencies (code),
  sold boolean not null default true,
  sort integer not null default 0,
  check (target_type <> 'organization' or org_type <> 'employer')
);

comment on table billing.boost_products is
  'The boosts on sale: one row per type of company and duration. Draft prices (OPEN_QUESTIONS.md C8). A boost is never a plan feature.';

-- The product rows, as in supabase/seeds/ref/plans.sql: a rebuilt database gets them from the seed (after the currencies
-- they refer to), and this statement adds them to a database whose currencies exist already.
insert into billing.boost_products (sku, target_type, org_type, days, price_minor, currency, sort)
select v.sku, 'organization', v.org_type::public.organization_type, v.days, v.price_minor, 'EUR', v.sort
from (values
  ('boost_recruitment_7d', 'recruitment_company', 7, 5900, 10),
  ('boost_recruitment_14d', 'recruitment_company', 14, 10900, 20),
  ('boost_recruitment_30d', 'recruitment_company', 30, 19900, 30),
  ('boost_staffing_7d', 'staffing_company', 7, 4900, 10),
  ('boost_staffing_14d', 'staffing_company', 14, 8900, 20),
  ('boost_staffing_30d', 'staffing_company', 30, 13900, 30)
) as v (sku, org_type, days, price_minor, sort)
where exists (select 1 from public.currencies c where c.code = 'EUR')
on conflict (sku) do nothing;

-- Written only by billing_apply_event. One row per successful payment: provider_payment_ref is unique, so a payment the
-- provider reports twice (two events, or a retry) gives one boost.
create table billing.boosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  sku text not null references billing.boost_products (sku),
  target_type text not null check (target_type in ('job', 'organization')),
  target_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  provider text not null check (provider in ('null', 'stripe')),
  provider_payment_ref text not null unique check (provider_payment_ref <> ''),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (target_type <> 'organization' or target_id = organization_id)
);

comment on table billing.boosts is
  'Paid boosts, created by the billing webhook when a payment succeeds. Read by the directory rail (public.boosted_partners) and by the members of the organisation (public.v_active_boosts); never by a search or match function.';

create index boosts_target_idx on billing.boosts (target_type, target_id, ends_at);
create index boosts_organization_idx on billing.boosts (organization_id, ends_at desc);

alter table billing.boost_products owner to billing_owner;
alter table billing.boosts owner to billing_owner;

alter table billing.boost_products enable row level security;
alter table billing.boost_products force row level security;
alter table billing.boosts enable row level security;
alter table billing.boosts force row level security;

revoke all on billing.boost_products, billing.boosts from public, anon, authenticated, service_role;

create policy boost_products_all_billing_owner on billing.boost_products
  for all to billing_owner using (true) with check (true);
create policy boosts_all_billing_owner on billing.boosts
  for all to billing_owner using (true) with check (true);

-- Everyone reads the products on sale; a member reads the boosts of the own organisation, without the payment reference.
grant select on billing.boost_products to anon, authenticated;
create policy boost_products_select_sold on billing.boost_products
  for select to anon, authenticated
  using (sold);

grant select (id, organization_id, sku, target_type, target_id, starts_at, ends_at, created_at)
  on billing.boosts to authenticated;
create policy boosts_select_member on billing.boosts
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- The orders and the events of the provider take the boost payments.
alter table billing.orders drop constraint orders_kind_check;
alter table billing.orders add constraint orders_kind_check check (kind in ('subscription', 'boost'));

alter table billing.provider_events drop constraint provider_events_kind_check;
alter table billing.provider_events add constraint provider_events_kind_check check (kind in (
  'checkout.completed', 'subscription.activated', 'subscription.updated', 'subscription.canceled',
  'subscription.trial_will_end', 'payment.succeeded', 'payment.failed', 'boost.paid'
));
alter table billing.provider_events drop constraint provider_events_error_check;
alter table billing.provider_events add constraint provider_events_error_check check (error in (
  'unknown_plan', 'customer_conflict', 'org_not_linked', 'transient', 'unknown_product', 'org_mismatch'
));

-- Views ----------------------------------------------------------------------------------------------------------------

create view public.v_boost_products with (security_invoker = true) as
select p.sku, p.target_type, p.org_type, p.days, p.price_minor, p.currency, p.sort
from billing.boost_products p;

-- The boosts of the caller's organisations that have not ended (the current one and any bought to follow it).
create view public.v_active_boosts with (security_invoker = true) as
select b.id, b.organization_id, b.sku, b.target_type, b.target_id, b.starts_at, b.ends_at
from billing.boosts b
where b.ends_at > now();

revoke all on public.v_boost_products, public.v_active_boosts from public, anon, authenticated, service_role;
grant select on public.v_boost_products to anon, authenticated;
grant select on public.v_active_boosts to authenticated;

-- Checkout -------------------------------------------------------------------------------------------------------------

-- The start of a boost checkout (billing-checkout, action boost): an owner or admin at aal2 of an active, listed
-- partner buys a product of the own type while release_boosts is on. The amount, the currency and the duration come
-- from the product row, never from the caller; the provider is the one of billing-checkout. Writes one audit row and
-- nothing else: the boost itself is created by the webhook once the payment succeeded.
create function public.billing_boost_checkout_start(p_org uuid, p_sku text, p_provider text default 'null')
returns table (slug text, customer_ref text, amount_minor integer, currency text, days integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_product billing.boost_products;
begin
  perform private.assert_company_account();
  perform private.assert_org_manager(p_org, 'admin');
  select * into v_org from public.organizations o where o.id = p_org;

  if p_provider is null or p_provider not in ('null', 'stripe') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'provider', errcode = '22023';
  end if;
  if not private.release_on('release_boosts') or not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'boosts_off', errcode = '42501';
  end if;
  select * into v_product from billing.boost_products p where p.sku = p_sku;
  if not found then
    raise exception 'CHARA_FORBIDDEN' using detail = 'unknown_product', errcode = '42501';
  end if;
  if v_product.target_type <> 'organization' or v_product.org_type <> v_org.type then
    raise exception 'CHARA_FORBIDDEN' using detail = 'product_not_for_org_type', errcode = '42501';
  end if;
  if not v_product.sold then
    raise exception 'CHARA_FORBIDDEN' using detail = 'product_not_sold', errcode = '42501';
  end if;
  if v_org.listed_at is null or v_org.review_status = 'declined' or v_org.moderation_state <> 'visible' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'not_listed', errcode = '42501';
  end if;

  perform audit.record(
    'billing.boost_checkout_started', 'organization', p_org::text,
    jsonb_build_object('sku', v_product.sku, 'amount_minor', v_product.price_minor, 'currency', v_product.currency)
  );
  return query
  select v_org.slug,
    (select c.customer_ref from billing.customers c where c.organization_id = p_org and c.provider = p_provider),
    v_product.price_minor, v_product.currency, v_product.days;
end;
$$;

revoke all on function public.billing_boost_checkout_start(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.billing_boost_checkout_start(uuid, text, text) to authenticated;

-- Webhook --------------------------------------------------------------------------------------------------------------

-- A paid boost checkout: one order and one boost, in the transaction of the event. The product must exist and be of the
-- organisation's type (else the event is an error and nothing is created). A boost bought while another of the same
-- profile runs starts at its end; otherwise it starts now, when the payment is applied. A payment reference already
-- holding a boost changes nothing.
create function billing.apply_boost_paid(p_ev billing.provider_events, p_org uuid, out outcome text, out from_status text, out to_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := p_ev.payload;
  v_product billing.boost_products;
  v_starts timestamptz;
begin
  select * into v_product from billing.boost_products p where p.sku = v_p ->> 'sku';
  if not found then
    outcome := 'unknown_product';
    return;
  end if;
  if v_product.target_type <> 'organization'
     or v_product.org_type is distinct from (select o.type from public.organizations o where o.id = p_org) then
    outcome := 'org_mismatch';
    return;
  end if;
  -- A boost has no subscription status: the audit row of the event names none.
  from_status := null;
  to_status := null;
  outcome := 'applied';
  if exists (select 1 from billing.boosts b where b.provider_payment_ref = v_p ->> 'providerPaymentRef') then
    return;
  end if;

  if (v_p ->> 'amountMinor')::integer > 0 then
    insert into billing.orders (organization_id, kind, sku_or_plan, amount_minor, tax_minor, currency, provider, provider_ref)
    values (
      p_org, 'boost', v_product.sku, (v_p ->> 'amountMinor')::integer, coalesce((v_p ->> 'taxMinor')::integer, 0),
      v_p ->> 'currency', p_ev.provider, v_p ->> 'providerPaymentRef'
    ) on conflict (provider, provider_ref) do nothing;
  end if;

  -- greatest ignores the null of an organisation without boosts.
  select greatest(now(), max(b.ends_at)) into v_starts
  from billing.boosts b where b.target_type = 'organization' and b.target_id = p_org;
  insert into billing.boosts (organization_id, sku, target_type, target_id, starts_at, ends_at, provider, provider_payment_ref)
  values (
    p_org, v_product.sku, 'organization', p_org, v_starts, v_starts + make_interval(days => v_product.days), p_ev.provider,
    v_p ->> 'providerPaymentRef'
  );
end;
$$;

alter function billing.apply_boost_paid(billing.provider_events, uuid) owner to billing_owner;
revoke all on function billing.apply_boost_paid(billing.provider_events, uuid) from public, anon, authenticated, service_role;

-- billing_apply_event of 20261104130000_subscription_states.sql with the boost.paid kind and its two errors (an unknown
-- product, a product of another organisation type).
create or replace function public.billing_apply_event(p_event_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev billing.provider_events;
  v_org uuid;
  v_out record;
begin
  select * into v_ev from billing.provider_events e where e.id = p_event_id;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'received' then
    return v_ev.status;
  end if;

  v_org := billing.resolve_organization(v_ev.provider, v_ev.payload);
  if v_org is null then
    return 'received';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:' || v_org::text, 0));
  select * into v_ev from billing.provider_events e where e.id = p_event_id for update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'received' then
    return v_ev.status;
  end if;

  if v_ev.kind = 'checkout.completed' then
    select * into v_out from billing.apply_checkout(v_ev, v_org);
  elsif v_ev.kind = 'payment.failed' then
    select * into v_out from billing.apply_payment_failed(v_ev, v_org);
  elsif v_ev.kind = 'payment.succeeded' then
    select * into v_out from billing.apply_payment_succeeded(v_ev, v_org);
  elsif v_ev.kind = 'subscription.trial_will_end' then
    select * into v_out from billing.apply_trial_will_end(v_ev, v_org);
  elsif v_ev.kind = 'boost.paid' then
    select * into v_out from billing.apply_boost_paid(v_ev, v_org);
  else
    select * into v_out from billing.apply_subscription(v_ev, v_org);
  end if;

  if v_out.outcome = 'unresolved' then
    return 'received';
  elsif v_out.outcome = 'stale' then
    update billing.provider_events set status = 'stale' where id = v_ev.id;
    return 'stale';
  elsif v_out.outcome in ('unknown_plan', 'customer_conflict', 'unknown_product', 'org_mismatch') then
    update billing.provider_events set status = 'error', error = v_out.outcome where id = v_ev.id;
    perform private.raise_alert('billing_event_error', jsonb_build_object(
      'event_id', v_ev.id, 'kind', v_ev.kind, 'error', v_out.outcome, 'organization_id', v_org
    ));
    return 'error';
  end if;

  -- In the transaction of the event, so that a failed pause rolls the status back and the retry job tries the event again.
  if v_out.to_status = 'canceled' and v_out.from_status is distinct from 'canceled' then
    perform private.pause_jobs_on_lapse(v_org);
  end if;

  update billing.provider_events set status = 'applied', applied_at = now() where id = v_ev.id;
  perform private.billing_audit('billing.event_applied', 'organization', v_org::text, jsonb_build_object(
    'event_id', v_ev.id, 'kind', v_ev.kind, 'organization_id', v_org,
    'from_status', v_out.from_status, 'to_status', v_out.to_status
  ));
  return 'applied';
end;
$$;

-- Directory rail -------------------------------------------------------------------------------------------------------

-- The boosted partners of one directory search, for the rail above the organic results: at most three, each with a
-- boost of the directory's type running now, listed and visible, and matching every filter of the search (the filters
-- of search_partners, all of them required here, so a welding agency is never shown to someone looking for cooks). A
-- filter that search_partners refuses (an advanced filter the caller may not use, a value out of range) gives an empty
-- rail: the organic results explain the refusal. The rail is not counted against the visitor limit: it returns at most
-- three public profiles that the same search lists anyway, and it is only read alongside search_partners, which counts.
--
-- The order rotates the slots fairly without storing anything per view: the boosted partners are shuffled by a hash of
-- their id and the current hour (UTC), so each hour brings another pseudo-random order, every partner has the same
-- chance of each slot over time, and one page shows the same rail for the whole hour (and a test can predict it).
create function public.boosted_partners(
  p_kind text,
  p_destination text default null,
  p_occupation text default null,
  p_based_in text default null,
  p_sources_from text[] default null,
  p_industry text default null,
  p_language text default null,
  p_recruitment_type public.recruitment_preference default null,
  p_staffing_types text[] default null,
  p_workforce_size text default null,
  p_capacity integer default null,
  p_within_days integer default null
)
returns table (
  id uuid, slug text, display_name text, organization_type public.organization_type, based_in_country text,
  served_countries jsonb, main_occupations jsonb, staffing_types public.partner_service_type[]
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_type public.organization_type;
  v_destination text := upper(p_destination);
  v_based_in text := upper(p_based_in);
  v_industry text := upper(p_industry);
  v_language text := lower(p_language);
  v_size text := lower(p_workforce_size);
  v_sources text[] := (select array_agg(upper(s.code)) from unnest(p_sources_from) s (code));
  v_types text[] := (select array_agg(lower(t.code)) from unnest(p_staffing_types) t (code));
  v_listing_filter boolean := p_capacity is not null or p_within_days is not null;
  v_fresh_since timestamptz := private.workforce_fresh_since();
  v_hour text := to_char(date_trunc('hour', now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24');
begin
  if not private.release_on('release_boosts') or not private.release_on('release_partner_directories') then
    return;
  end if;
  v_type := case p_kind
    when 'recruitment' then 'recruitment_company'::public.organization_type
    when 'staffing' then 'staffing_company'::public.organization_type
  end;
  if v_type is null or p_recruitment_type = 'both' or cardinality(p_sources_from) > 20 or cardinality(p_staffing_types) > 10
     or p_capacity not between 1 and 100000 or p_within_days not between 1 and 365 then
    return;
  end if;
  if (v_listing_filter or cardinality(v_sources) > 1) and (v_uid is null or not exists (
    select 1 from private.member_org_ids() m (organization_id) where private.has_feature(m.organization_id, 'advanced_partner_search')
  )) then
    return;
  end if;

  return query
  select
    o.id, o.slug, o.display_name, o.type, o.based_in_country,
    (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name, c.code), '[]'::jsonb)
     from public.organization_geographies g
     join public.countries c on c.code = g.country_code
     where g.organization_id = o.id and g.scope = 'serves_market'),
    (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.label) order by t.label, t.code), '[]'::jsonb)
     from (
       select oc.code, oc.label
       from public.organization_occupations oo
       join public.occupations oc on oc.code = oo.occupation_id
       where oo.organization_id = o.id
       order by oc.label, oc.code
       limit 5
     ) t),
    (select coalesce(array_agg(st.service order by st.service), '{}')
     from public.organization_service_types st
     where st.organization_id = o.id and st.service <> 'staffing')
  from public.organizations o
  where o.type = v_type
    and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active' and o.moderation_state = 'visible'
    and exists (
      select 1 from billing.boosts b
      join billing.boost_products p on p.sku = b.sku
      where b.target_type = 'organization' and b.target_id = o.id and p.org_type = v_type
        and b.starts_at <= now() and b.ends_at > now()
    )
    and (v_destination is null or exists (
      select 1 from public.organization_geographies g
      where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination
    ))
    and (p_occupation is null or exists (
      select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = p_occupation
    ))
    and (v_based_in is null or o.based_in_country = v_based_in)
    and (v_sources is null or exists (
      select 1 from public.organization_geographies g
      where g.organization_id = o.id and g.scope = 'sources_from' and g.country_code = any (v_sources)
    ))
    and (v_industry is null or exists (
      select 1 from public.organization_industries i where i.organization_id = o.id and i.industry_code = v_industry
    ))
    and (v_language is null or exists (
      select 1 from public.organization_languages l where l.organization_id = o.id and l.language_code = v_language
    ))
    and (p_recruitment_type is null or o.recruitment_type in ('both', p_recruitment_type))
    and (v_types is null or exists (
      select 1 from public.organization_service_types st where st.organization_id = o.id and st.service::text = any (v_types)
    ))
    and (v_size is null or o.workforce_size_band::text = v_size)
    and (not v_listing_filter or exists (
      select 1 from public.workforce_availability a
      where a.organization_id = o.id and a.confirmed_at > v_fresh_since
        and (p_occupation is null or a.occupation_id = p_occupation)
        and (p_capacity is null or a.available >= p_capacity)
        and (p_within_days is null or a.available_from <= (now() at time zone 'utc')::date + p_within_days)
    ))
  order by md5(o.id::text || v_hour), o.id
  limit 3;
end;
$$;

revoke all on function public.boosted_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.boosted_partners(text, text, text, text, text[], text, text, public.recruitment_preference, text[], text, integer, integer)
  to anon, authenticated;
