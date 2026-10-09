-- Vacancy moderation (FR-C7; ARCHITECTURE.md sections 4, 8, 11; OPEN_QUESTIONS.md D45, D66). Only a Trust & Safety
-- Administrator at aal2 hides or unhides a vacancy, with a statement of reasons of 10 to 2000 characters (the limits of
-- every administrative action). A hide writes one moderation_actions row and one audit row in the transaction of the
-- change and queues the mandatory vacancy_hidden email to the owner and the administrators of the organisation. A hidden
-- vacancy keeps its status; the public policies already ask for moderation_state = 'visible'.

-- The record of a moderation action now also names a vacancy.
alter table public.moderation_actions drop constraint moderation_actions_target_type_check;
alter table public.moderation_actions drop constraint moderation_actions_action_check;
alter table public.moderation_actions drop constraint moderation_actions_check;
alter table public.moderation_actions add constraint moderation_actions_target_action_check
  check ((target_type, action) in (
    ('profile', 'account_suspended'), ('profile', 'account_reinstated'),
    ('organization', 'organization_suspended'), ('organization', 'organization_reinstated'),
    ('job', 'job_hidden'), ('job', 'job_unhidden')
  ));

comment on table public.moderation_actions is
  'Append-only record of the suspensions and reinstatements of users and organisations and of the hiding and unhiding of vacancies. actor_id and target_id have no foreign key: the record outlives an erased account, and a deleted profile would otherwise update it.';

create index moderation_actions_accounts_idx on public.moderation_actions (id desc) where target_type <> 'job';

-- The page of suspensions and reinstatements lists accounts and organisations; the vacancies have their own history.
create or replace function public.admin_list_moderation_actions(p_limit integer default 25, p_after_id bigint default null)
returns table (
  id bigint, target_type text, target_id uuid, target_name text, action text, statement_of_reasons text,
  actor_id uuid, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);

  return query
  select
    a.id, a.target_type, a.target_id,
    case a.target_type
      when 'organization' then (select o.display_name from public.organizations o where o.id = a.target_id)
      else (select coalesce(p.display_name, u.email::text) from public.profiles p join auth.users u on u.id = p.id where p.id = a.target_id)
    end,
    a.action, a.statement_of_reasons, a.actor_id, a.created_at
  from public.moderation_actions a
  where a.target_type <> 'job' and (p_after_id is null or a.id < p_after_id)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

-- The recipients of a notice to an organisation (the owner and each administrator) are chosen in one place; p_extra adds
-- keys to the queue message, here the vacancy.
drop function private.queue_organization_notice(text, uuid, text);
create function private.queue_organization_notice(p_kind text, p_org uuid, p_reason text, p_extra jsonb default '{}') returns void
language sql
security definer
set search_path = ''
as $$
  select pgmq.send('notifications', jsonb_build_object(
    'kind', p_kind, 'user_id', m.user_id, 'mandatory', true, 'organization_id', p_org, 'reasons', p_reason
  ) || p_extra)
  from public.organization_members m
  where m.organization_id = p_org and m.role in ('owner', 'admin') and m.accepted_at is not null
$$;

revoke all on function private.queue_organization_notice(text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- p_action is 'hide' or 'unhide'. A vacancy is hidden only while it is visible and unhidden only while it is hidden; the
-- row is locked, so of two simultaneous calls one finds the new state and is refused. A vacancy of a suspended
-- organisation that is unhidden goes to org_suspended, not to visible: it stays out of the public until the organisation
-- is reinstated, which is the only thing that makes its vacancies visible again.
create function public.moderate_job(p_job uuid, p_action text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_hide boolean;
  v_state public.job_moderation_state;
  v_org uuid;
  v_org_status public.organization_status;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_reason := private.statement_of_reasons(p_reason);
  if p_action not in ('hide', 'unhide') then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'action';
  end if;
  if p_job is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job';
  end if;
  v_hide := p_action = 'hide';

  select j.organization_id into v_org from public.jobs j where j.id = p_job and j.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The organisation is locked before the vacancy, the order of suspend_organization and reinstate_organization, so that
  -- the status read here cannot change before this transaction ends and the two cannot deadlock.
  select o.status into v_org_status from public.organizations o where o.id = v_org for share;
  select j.moderation_state into v_state
  from public.jobs j where j.id = p_job and j.deleted_at is null and j.organization_id = v_org for no key update;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_state <> (case when v_hide then 'visible' else 'hidden' end)::public.job_moderation_state then
    raise exception 'CHARA_INVALID_STATE' using detail = v_state::text;
  end if;

  update public.jobs
  set moderation_state = (case
    when v_hide then 'hidden'
    when v_org_status = 'suspended' then 'org_suspended'
    else 'visible'
  end)::public.job_moderation_state
  where id = p_job;
  perform private.record_moderation('job', p_job, case when v_hide then 'job_hidden' else 'job_unhidden' end, case when v_hide then 'job.hide' else 'job.unhide' end, v_reason);

  if v_hide then
    perform private.queue_organization_notice('vacancy_hidden', v_org, v_reason, jsonb_build_object('job_id', p_job));
  end if;
end;
$$;

revoke all on function public.moderate_job(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.moderate_job(uuid, text, text) to authenticated;

-- A term that matches many titles is answered by walking the vacancies newest first until a page is full; the trigram index
-- answers a rare term. Without this index every page sorted all the matches.
create index jobs_newest_idx on public.jobs (created_at desc, id desc) where deleted_at is null;

-- The vacancies of every organisation by part of the title, part of the name of the organisation or the vacancy id,
-- newest first in keyset pages of (created_at, id). Nothing of an application is read; a soft-deleted vacancy is left out.
-- Each call is planned with its own values: after five calls a connection switches to a generic plan, which cannot see
-- the term or the cursor and took 100 times as long at 200,000 vacancies.
create function public.admin_search_jobs(
  p_term text, p_limit integer default 25, p_after_at timestamptz default null, p_after_id uuid default null
) returns table (
  id uuid, title text, organization_name text, status public.job_status, moderation_state public.job_moderation_state,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_after_at timestamptz := coalesce(p_after_at, 'infinity');
  v_after_id uuid := coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  v_id uuid := case when btrim(p_term) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then btrim(p_term)::uuid end;
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  v_like := private.search_pattern(p_term);

  -- Each branch applies the cursor (no cursor is the largest key, so the condition is always a range an index can use) and
  -- takes at most one page, so the union holds at most three pages however many vacancies match.
  return query
  with hits as (
    (select j.id, j.created_at from public.jobs j
     where j.title ilike v_like and j.deleted_at is null and (j.created_at, j.id) < (v_after_at, v_after_id)
     order by j.created_at desc, j.id desc limit v_limit)
    union
    (select j.id, j.created_at from public.organizations o
     cross join lateral (
       select x.id, x.created_at from public.jobs x
       where x.organization_id = o.id and x.deleted_at is null and (x.created_at, x.id) < (v_after_at, v_after_id)
       order by x.created_at desc, x.id desc limit v_limit
     ) j
     where lower(o.display_name) like v_like
     order by j.created_at desc, j.id desc limit v_limit)
    union
    (select j.id, j.created_at from public.jobs j
     where j.id = v_id and j.deleted_at is null and (j.created_at, j.id) < (v_after_at, v_after_id))
  )
  select j.id, j.title, o.display_name, j.status, j.moderation_state, j.created_at
  from hits h
  join public.jobs j on j.id = h.id
  join public.organizations o on o.id = j.organization_id
  order by h.created_at desc, h.id desc
  limit v_limit;
end;
$$;

revoke all on function public.admin_search_jobs(text, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_jobs(text, integer, timestamptz, uuid) to authenticated;

-- One vacancy to assess: the text the employer wrote and its moderation history, the latest 20 actions. The staff role has
-- no other way to read a hidden or draft vacancy, and no access to its applications.
create function public.admin_get_job(p_job uuid) returns table (
  id uuid, title text, description text, organization_id uuid, organization_name text, country_code text, city text,
  status public.job_status, moderation_state public.job_moderation_state, created_at timestamptz, history jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['trust_safety']::public.platform_role[]);
  if p_job is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'job';
  end if;

  return query
  select
    j.id, j.title, j.description, j.organization_id, o.display_name, j.country_code, j.city, j.status, j.moderation_state,
    j.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('action', h.action, 'reasons', h.statement_of_reasons, 'at', h.created_at) order by h.id desc)
      from (
        select a.id, a.action, a.statement_of_reasons, a.created_at
        from public.moderation_actions a
        where a.target_type = 'job' and a.target_id = j.id
        order by a.id desc
        limit 20
      ) h
    ), '[]'::jsonb)
  from public.jobs j
  join public.organizations o on o.id = j.organization_id
  where j.id = p_job and j.deleted_at is null;
  if not found then
    raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_get_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_job(uuid) to authenticated;
