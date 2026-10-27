-- Direct-hiring rules by country (FR-Q5, SOP P2-34; decisions 4.5, 6.1; NFR-C6, NFR-O5, NFR-S8; docs/phase-2/DATA_MODEL.md
-- sections 5, 6, 7 and 10; release 2b). A Platform Administrator at aal2 sets, per source country and optionally per
-- destination country, whether direct hiring is allowed, needs a licensed partner or is blocked, with the notice people
-- are shown and the reference of the legal opinion the rule rests on. The platform does not decide what the law of a
-- country is: no rule is seeded, and a source country without a rule allows direct hiring with the general notice
-- (setting direct_hiring_general_notice, the worker statement of the Platform Rules, editable in the settings editor).
--
-- The source is always the worker's current country (worker_profiles.current_country), never a nationality, which the
-- platform does not hold. private.direct_hiring_rule resolves a pair: the rule for the pair, else the rule for the source
-- with no destination, else allowed with the general notice. hiring_rule_notice gives anyone the rule value and notice of a
-- pair while release 2b is on; the legal opinion reference, who changed a rule and its history are read by
-- administrators only. Enforcement in Find Workers, contact requests, invitations to apply and apply_to_job, and the
-- licence check of partner responses, arrive with V72 and V44; the partner channel is never refused by a rule.
--
-- Like the plan, settings and retention editors, the admin functions are not behind a release switch: the rules have to
-- be set after legal review before release 2b or 2c goes live. Every change is audited (direct_hiring_rule.created,
-- .updated, .deleted with the values before and after and the statement of reasons); a call that changes nothing writes
-- nothing. A rule is flagged for review when it has not changed for direct_hiring_review_days (365).

create type public.direct_hiring_rule_value as enum ('allowed', 'licensed_partner_required', 'blocked');

insert into private.settings (key, value) values
  ('direct_hiring_general_notice', to_jsonb(
    'Workers never pay. Nobody may ask you for a fee, a deposit or any other payment for finding work or for applying. '
    || 'If anyone asks, do not pay and report the request to CHARA.'::text)),
  ('direct_hiring_review_days', '365')
on conflict (key) do nothing;

insert into private.setting_rules (key, value_type, min, max, label, release_feature) values
  ('direct_hiring_general_notice', 'text', 20, 1000, 'Direct-hiring notice where no country rule applies', null),
  ('direct_hiring_review_days', 'integer', 30, 1095, 'Days after which a direct-hiring rule is flagged for review', null);

create table public.direct_hiring_rules (
  id uuid primary key default gen_random_uuid(),
  source_country text not null references public.countries (code),
  destination_country text references public.countries (code),
  rule public.direct_hiring_rule_value not null,
  notice text not null,
  legal_opinion_ref text not null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_hiring_rules_pair_key unique nulls not distinct (source_country, destination_country),
  constraint direct_hiring_rules_destination_check check (destination_country <> source_country),
  constraint direct_hiring_rules_notice_check check (
    notice = btrim(notice) and char_length(notice) between 20 and 1000 and notice !~ '[[:cntrl:]]'
  ),
  constraint direct_hiring_rules_legal_opinion_ref_check check (
    legal_opinion_ref = btrim(legal_opinion_ref) and char_length(legal_opinion_ref) between 1 and 200
    and legal_opinion_ref !~ '[[:cntrl:]]'
  )
);

comment on table public.direct_hiring_rules is
  'FR-Q5 direct-hiring rules: per source country (the worker''s current country) and optional destination (null = any), allowed, licensed partner required or blocked, with the notice shown and the legal opinion reference. Written by admin_upsert_direct_hiring_rule and admin_delete_direct_hiring_rule only (audited); read through hiring_rule_notice (rule and notice) and the admin functions. No API grant.';

create index direct_hiring_rules_destination_idx on public.direct_hiring_rules (destination_country)
  where destination_country is not null;
create index direct_hiring_rules_updated_by_idx on public.direct_hiring_rules (updated_by) where updated_by is not null;

alter table public.direct_hiring_rules enable row level security;
alter table public.direct_hiring_rules force row level security;
revoke all on table public.direct_hiring_rules from public, anon, authenticated, service_role;

-- Resolution ----------------------------------------------------------------------------------------------------------

-- The rule of a source and destination: the pair, else the source with any destination, else allowed with the general
-- notice and no rule id. A null source (a worker who has not given a country) and a null destination match no pair.
create function private.direct_hiring_rule(p_source text, p_destination text)
returns table (rule public.direct_hiring_rule_value, notice text, rule_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rule, r.notice, r.id
  from (
    select x.rule, x.notice, x.id, 0 as specificity
    from public.direct_hiring_rules x
    where x.source_country = p_source and x.destination_country = p_destination
    union all
    select x.rule, x.notice, x.id, 1
    from public.direct_hiring_rules x
    where x.source_country = p_source and x.destination_country is null
    union all
    select 'allowed'::public.direct_hiring_rule_value, s.value #>> '{}', null::uuid, 2
    from private.settings s
    where s.key = 'direct_hiring_general_notice'
  ) r
  order by r.specificity
  limit 1
$$;

revoke all on function private.direct_hiring_rule(text, text) from public, anon, authenticated, service_role;

-- The rule value and notice of a pair for any caller (FR-Q5 AC11), while release 2b is on: what a vacancy, a job order or
-- a requirement page shows. A malformed code is CHARA_INVALID_INPUT; a code without a rule gets the default.
create function public.hiring_rule_notice(p_source text, p_destination text default null)
returns table (rule public.direct_hiring_rule_value, notice text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.release_on('release_job_orders') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off', errcode = '42501';
  end if;
  if p_source is null or p_source !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'source_country';
  end if;
  if p_destination is not null and p_destination !~ '^[A-Z]{2}$' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'destination_country';
  end if;
  return query select d.rule, d.notice from private.direct_hiring_rule(p_source, p_destination) d;
end;
$$;

revoke all on function public.hiring_rule_notice(text, text) from public, anon, authenticated, service_role;
grant execute on function public.hiring_rule_notice(text, text) to anon, authenticated;

-- The editor ----------------------------------------------------------------------------------------------------------

create function private.direct_hiring_rule_values(p_rule public.direct_hiring_rules) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'source_country', p_rule.source_country, 'destination_country', p_rule.destination_country, 'rule', p_rule.rule,
    'notice', p_rule.notice, 'legal_opinion_ref', p_rule.legal_opinion_ref
  )
$$;

revoke all on function private.direct_hiring_rule_values(public.direct_hiring_rules) from public, anon, authenticated, service_role;

-- Creates the rule of a source and destination (null or left out = any destination) or changes the one that exists (FR-Q5 AC1, AC3):
-- one row per pair, so a second rule for the same pair edits the first. Input is checked here and named in the detail
-- (source_country, destination_country, rule, notice, legal_opinion_ref, reason); the table's own checks stay behind it.
-- Returns whether anything changed; the same values again write nothing.
create function public.admin_upsert_direct_hiring_rule(
  p_source text, p_rule text, p_notice text, p_legal_opinion_ref text, p_reason text, p_destination text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.assert_staff(array['admin']::public.platform_role[]);
  v_reason text := private.plan_editor_reason(p_reason);
  v_rule public.direct_hiring_rule_value;
  v_notice text := btrim(p_notice);
  v_ref text := btrim(p_legal_opinion_ref);
  v_old public.direct_hiring_rules;
  v_new public.direct_hiring_rules;
begin
  perform set_config('chara.audit_reason', '', true);
  if p_source is null or not exists (select 1 from public.countries c where c.code = p_source) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'source_country';
  end if;
  if p_destination is not null
    and (p_destination = p_source or not exists (select 1 from public.countries c where c.code = p_destination)) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'destination_country';
  end if;
  if p_rule is null or p_rule not in (select unnest(enum_range(null::public.direct_hiring_rule_value))::text) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'rule';
  end if;
  v_rule := p_rule::public.direct_hiring_rule_value;
  if v_notice is null or char_length(v_notice) not between 20 and 1000 or v_notice ~ '[[:cntrl:]]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'notice';
  end if;
  if v_ref is null or char_length(v_ref) not between 1 and 200 or v_ref ~ '[[:cntrl:]]' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'legal_opinion_ref';
  end if;

  select * into v_old from public.direct_hiring_rules r
  where r.source_country = p_source and r.destination_country is not distinct from p_destination
  for update;

  if not found then
    insert into public.direct_hiring_rules (source_country, destination_country, rule, notice, legal_opinion_ref, updated_by)
    values (p_source, p_destination, v_rule, v_notice, v_ref, v_uid)
    returning * into v_new;
    perform private.audit_admin('direct_hiring_rule.created', 'direct_hiring_rule', v_new.id::text, v_reason,
      jsonb_build_object('before', null, 'after', private.direct_hiring_rule_values(v_new)));
    return true;
  end if;

  if v_old.rule = v_rule and v_old.notice = v_notice and v_old.legal_opinion_ref = v_ref then
    return false;
  end if;
  update public.direct_hiring_rules r
  set rule = v_rule, notice = v_notice, legal_opinion_ref = v_ref, updated_by = v_uid, updated_at = now()
  where r.id = v_old.id
  returning * into v_new;
  perform private.audit_admin('direct_hiring_rule.updated', 'direct_hiring_rule', v_new.id::text, v_reason,
    jsonb_build_object('before', private.direct_hiring_rule_values(v_old), 'after', private.direct_hiring_rule_values(v_new)));
  return true;
end;
$$;

revoke all on function public.admin_upsert_direct_hiring_rule(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_direct_hiring_rule(text, text, text, text, text, text) to authenticated;

-- Removes a rule (FR-Q5 AC12); its source country, or pair, returns to the next rule that applies or to the default.
create function public.admin_delete_direct_hiring_rule(p_rule uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_old public.direct_hiring_rules;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  v_reason := private.plan_editor_reason(p_reason);
  perform set_config('chara.audit_reason', '', true);
  delete from public.direct_hiring_rules r where r.id = p_rule returning * into v_old;
  if not found then
    raise exception 'CHARA_NOT_FOUND';
  end if;
  perform private.audit_admin('direct_hiring_rule.deleted', 'direct_hiring_rule', v_old.id::text, v_reason,
    jsonb_build_object('before', private.direct_hiring_rule_values(v_old), 'after', null));
end;
$$;

revoke all on function public.admin_delete_direct_hiring_rule(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_direct_hiring_rule(uuid, text) to authenticated;

-- Every rule with the country names, the legal opinion reference, who changed it last and when, and whether it is due
-- for review (unchanged for direct_hiring_review_days), source by name, the any-destination rule first.
create function public.admin_list_direct_hiring_rules()
returns table (
  id uuid, source_country text, source_name text, destination_country text, destination_name text,
  rule public.direct_hiring_rule_value, notice text, legal_opinion_ref text, updated_by_name text,
  created_at timestamptz, updated_at timestamptz, review_due boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  v_days := coalesce(
    (select (s.value #>> '{}')::integer from private.settings s where s.key = 'direct_hiring_review_days'), 365);
  return query
  select r.id, r.source_country, sc.name, r.destination_country, dc.name, r.rule, r.notice, r.legal_opinion_ref,
    coalesce(pr.display_name, u.email::text), r.created_at, r.updated_at,
    r.updated_at < now() - make_interval(days => v_days)
  from public.direct_hiring_rules r
  join public.countries sc on sc.code = r.source_country
  left join public.countries dc on dc.code = r.destination_country
  left join public.profiles pr on pr.id = r.updated_by
  left join auth.users u on u.id = r.updated_by
  order by sc.name, r.destination_country is not null, dc.name;
end;
$$;

revoke all on function public.admin_list_direct_hiring_rules() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_direct_hiring_rules() to authenticated;

-- The changes of the rules from the audit log, newest first: the administrator, the action, the values before and after
-- and the reason. A deleted rule keeps its history.
create function public.admin_list_direct_hiring_rule_history(p_limit integer default 50, p_before_id bigint default null)
returns table (
  id bigint, created_at timestamptz, actor_name text, action text, rule_id text, before jsonb, after jsonb, reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);
  return query
  select l.id, l.created_at, coalesce(pr.display_name, u.email::text), l.action, l.entity_id,
    l.metadata -> 'before', l.metadata -> 'after', l.metadata ->> 'reason'
  from audit.log l
  left join public.profiles pr on pr.id = l.actor_id
  left join auth.users u on u.id = l.actor_id
  where l.action in ('direct_hiring_rule.created', 'direct_hiring_rule.updated', 'direct_hiring_rule.deleted')
    and (p_before_id is null or l.id < p_before_id)
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.admin_list_direct_hiring_rule_history(integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_direct_hiring_rule_history(integer, bigint) to authenticated;
