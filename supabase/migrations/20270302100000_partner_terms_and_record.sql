-- A partner's standard terms and track record, shown on its workforce profile and public profile. Employers compare
-- agencies on cost and experience before they contact one; until now a fee appeared only in a response to a job order.
-- The standard terms are a starting point: a response still states the fee for its job order. The fee follows the rules
-- of a response (private.partner_fee_models): a placement fee or on request for a recruitment company, a rate or on
-- request for a staffing company, any of them for one that does both. The track record is stated by the company, except
-- the hires through Chara Pinnacle, which are counted from the responses employers selected and cannot be edited.

create table public.partner_standard_terms (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  fee_model public.fee_model not null,
  fee_amount numeric(10, 2),
  fee_currency text references public.currencies (code),
  guarantee_days smallint check (guarantee_days between 0 and 365),
  min_assignment_weeks smallint check (min_assignment_weeks between 1 and 260),
  note text check (char_length(note) between 1 and 300 and note = btrim(note) and note !~ '[[:cntrl:]]'),
  updated_at timestamptz not null default now(),
  -- The amount rules of partner_responses_fee: a fixed fee or a rate in a currency, a percentage without one, on request
  -- without either.
  constraint partner_standard_terms_fee check (case fee_model
    when 'on_request' then fee_amount is null and fee_currency is null
    when 'percent_first_year_salary' then fee_amount > 0 and fee_amount <= 100 and fee_currency is null
    else fee_amount > 0 and fee_amount <= 9999999.99 and fee_currency is not null
  end)
);

create table public.partner_track_records (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  placements_last_year integer check (placements_last_year between 0 and 1000000),
  countries_placed text[] not null default '{}' check (cardinality(countries_placed) <= 50),
  updated_at timestamptz not null default now()
);

alter table public.partner_standard_terms enable row level security;
alter table public.partner_standard_terms force row level security;
alter table public.partner_track_records enable row level security;
alter table public.partner_track_records force row level security;
revoke all on public.partner_standard_terms from public, anon, authenticated, service_role;
revoke all on public.partner_track_records from public, anon, authenticated, service_role;
-- The members read their own company's rows on the workforce profile; everyone else reads them through
-- get_partner_terms_and_record, which applies the visibility of the public profile.
grant select on public.partner_standard_terms to authenticated;
grant select on public.partner_track_records to authenticated;
create policy partner_standard_terms_member_select on public.partner_standard_terms for select to authenticated
  using (private.is_org_member(organization_id));
create policy partner_track_records_member_select on public.partner_track_records for select to authenticated
  using (private.is_org_member(organization_id));

-- Sets the standard terms of the caller's company (owner or admin at aal2 of a partner, as for listings). A fee model
-- outside the company's kind is refused; the guarantee belongs to a placement fee and the shortest assignment to a rate,
-- so the one that does not apply is dropped.
create function public.set_partner_standard_terms(
  p_org uuid,
  p_fee_model public.fee_model,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_guarantee_days integer default null,
  p_min_assignment_weeks integer default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_placement boolean := p_fee_model in ('fee_per_hire', 'percent_first_year_salary');
  v_rate boolean := p_fee_model in ('hourly_rate', 'monthly_rate');
begin
  perform private.assert_listing_manager(p_org);
  if p_fee_model is null or not p_fee_model = any (private.partner_fee_models(private.partner_kind(p_org))) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'fee_model_for_kind';
  end if;
  begin
    insert into public.partner_standard_terms (
      organization_id, fee_model, fee_amount, fee_currency, guarantee_days, min_assignment_weeks, note
    ) values (
      p_org, p_fee_model, p_fee_amount, nullif(upper(btrim(p_fee_currency)), ''),
      case when v_rate then null else p_guarantee_days end,
      case when v_placement then null else p_min_assignment_weeks end,
      v_note
    )
    on conflict (organization_id) do update
    set fee_model = excluded.fee_model, fee_amount = excluded.fee_amount, fee_currency = excluded.fee_currency,
        guarantee_days = excluded.guarantee_days, min_assignment_weeks = excluded.min_assignment_weeks,
        note = excluded.note, updated_at = now();
  exception
    when check_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'standard_terms';
    when foreign_key_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'fee_currency';
  end;
end;
$$;

-- Sets the stated track record of the caller's company. Every country must be one of the country list.
create function public.set_partner_track_record(
  p_org uuid,
  p_placements_last_year integer default null,
  p_countries_placed text[] default '{}'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_countries text[] := (
    select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}')
    from unnest(coalesce(p_countries_placed, '{}')) c
  );
begin
  perform private.assert_listing_manager(p_org);
  if exists (select 1 from unnest(v_countries) c where not exists (select 1 from public.countries k where k.code = c)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'countries_placed';
  end if;
  begin
    insert into public.partner_track_records (organization_id, placements_last_year, countries_placed)
    values (p_org, p_placements_last_year, v_countries)
    on conflict (organization_id) do update
    set placements_last_year = excluded.placements_last_year, countries_placed = excluded.countries_placed,
        updated_at = now();
  exception
    when check_violation then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'track_record';
  end;
end;
$$;

-- The standard terms and track record of a partner as its public profile shows them, with the hires through Chara
-- Pinnacle counted from the responses employers selected. Seen wherever the profile is: a listed, visible partner for
-- anyone while release 2a is on, and the company's own members always. Null for any other address.
create function public.get_partner_terms_and_record(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.release_on('release_partner_directories') then
    return null;
  end if;
  select o.id into v_org
  from public.organizations o
  where o.slug = p_slug and o.type <> 'employer'
    and ((o.moderation_state = 'visible' and private.is_listed_partner(o.id))
      or ((select auth.uid()) is not null and private.is_org_member(o.id)));
  if v_org is null then
    return null;
  end if;
  return jsonb_build_object(
    'terms', (
      select jsonb_build_object('fee_model', t.fee_model, 'fee_amount', t.fee_amount, 'fee_currency', t.fee_currency,
        'guarantee_days', t.guarantee_days, 'min_assignment_weeks', t.min_assignment_weeks, 'note', t.note)
      from public.partner_standard_terms t where t.organization_id = v_org
    ),
    'record', jsonb_build_object(
      'placements_last_year', (select r.placements_last_year from public.partner_track_records r where r.organization_id = v_org),
      'countries_placed', coalesce((
        select jsonb_agg(jsonb_build_object('code', k.code, 'name', k.name) order by k.name)
        from public.partner_track_records r cross join unnest(r.countries_placed) c
        join public.countries k on k.code = c
        where r.organization_id = v_org
      ), '[]'::jsonb),
      'founded_year', (select o.founded_year from public.organizations o where o.id = v_org),
      'platform_hires', (
        select count(*)::integer from public.partner_responses p where p.organization_id = v_org and p.status = 'selected'
      )
    )
  );
end;
$$;

revoke all on function public.set_partner_standard_terms(uuid, public.fee_model, numeric, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_partner_standard_terms(uuid, public.fee_model, numeric, text, integer, integer, text)
  to authenticated;
revoke all on function public.set_partner_track_record(uuid, integer, text[]) from public, anon, authenticated, service_role;
grant execute on function public.set_partner_track_record(uuid, integer, text[]) to authenticated;
revoke all on function public.get_partner_terms_and_record(text) from public, anon, authenticated, service_role;
grant execute on function public.get_partner_terms_and_record(text) to anon, authenticated;
