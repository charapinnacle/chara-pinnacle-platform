-- Saved partners, follows, the follower count and the follower digest (FR-L4, FR-K5 AC7; docs/phase-2/DATA_MODEL.md
-- sections 2, 6, 7 Discovery, 9 and 10; NFR-S8, NFR-A3).
--
-- An employer keeps partners at hand in public.saved_items, one row per saving organisation and partner, shared by its
-- members; the partner never learns who saved it. A signed-in user follows a listed partner or an employer whose company
-- page is on in public.follows, one personal row per user and company; the followed company reads a count, and only from
-- stats_min_count on, never who follows it. Both tables are written only by toggle_saved_partner and toggle_follow.
--
-- A vacancy published for the first time (published_at newly set by the lifecycle guard) of a followed company is put in
-- private.follow_activity_outbox; the hourly job follower-digest turns it into one followed_company_activity notification
-- per follower and company and UTC day, listing what the company published since that follower's last digest. The email
-- follows the follower's choice for the kind; the in-app item is always written. Job orders join the outbox with release
-- 2b (V54).
--
-- Everything here answers only while release_partner_directories is on; the job does nothing while it is off.

-- The notification kind -------------------------------------------------------------------------------------------------

insert into private.notification_kinds (kind, mandatory, default_email, audience, label) values
  ('followed_company_activity', false, true, 'all', 'New vacancies of companies you follow');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'application_received', 'status_changed', 'vacancy_hidden', 'trial_ending', 'payment_failed', 'legal_version',
  'mfa_reset', 'deletion_requested', 'deletion_completed', 'erasure_paused', 'member_invitation', 'account_suspended',
  'account_reinstated', 'account_exists', 'partner_approved', 'partner_info_requested', 'partner_declined',
  'licence_expiring', 'partner_licence_expired', 'listing_confirmation_due', 'followed_company_activity'
)) not valid;
alter table public.notifications validate constraint notifications_kind_check;

-- Tables -----------------------------------------------------------------------------------------------------------------

-- saved_by follows the profile and is cleared when the account goes (the row stays an organisation record, FR-L4 AC8).
create table public.saved_items (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'partner' check (kind = 'partner'),
  saved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, target_organization_id),
  check (organization_id <> target_organization_id)
);

comment on table public.saved_items is
  'The partners an employer saved (FR-L4), shared by its members. Written only by toggle_saved_partner; the saved partner never reads it.';

-- The list reads one organisation's rows newest first; the foreign key of the target needs its own index for the cascade.
create index saved_items_list_idx on public.saved_items (organization_id, created_at desc, target_organization_id desc);
create index saved_items_target_idx on public.saved_items (target_organization_id);
create index saved_items_saved_by_idx on public.saved_items (saved_by);

alter table public.saved_items enable row level security;
alter table public.saved_items force row level security;
revoke all on table public.saved_items from public, anon, authenticated, service_role;
grant select on public.saved_items to authenticated;

create policy saved_items_select_member on public.saved_items
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- last_digest_at: when follower-digest last queued followed_company_activity for this follow; the next digest lists what
-- the company published after it, and none comes before the next UTC day.
create table public.follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_digest_at timestamptz,
  primary key (user_id, organization_id)
);

comment on table public.follows is
  'The companies a user follows (FR-L4), personal to the user. Written only by toggle_follow; the followed company reads a count through follower_count, never the rows.';

create index follows_list_idx on public.follows (user_id, created_at desc, organization_id desc);
create index follows_organization_idx on public.follows (organization_id);

alter table public.follows enable row level security;
alter table public.follows force row level security;
revoke all on table public.follows from public, anon, authenticated, service_role;
grant select on public.follows to authenticated;

create policy follows_select_own on public.follows
  for select to authenticated
  using (user_id = (select auth.uid()));

-- What a followed company published, until every follower's digest has passed it (two days at most: a follower gets a
-- digest at most once per UTC day and the job runs hourly).
create table private.follow_activity_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type = 'vacancy'),
  entity_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

create index follow_activity_outbox_org_idx on private.follow_activity_outbox (organization_id, created_at);
create index follow_activity_outbox_created_idx on private.follow_activity_outbox (created_at);

alter table private.follow_activity_outbox enable row level security;
alter table private.follow_activity_outbox force row level security;
revoke all on table private.follow_activity_outbox from public, anon, authenticated, service_role;

-- Helpers ----------------------------------------------------------------------------------------------------------------

-- Whether a partner is public (the predicate of get_partner_profile), so an employer may save it and anyone follow it.
create function private.is_public_partner(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.type <> 'employer' and o.moderation_state = 'visible' and private.is_listed_partner(o.id)
  )
$$;

-- Whether a company can be followed and appears in follow lists and digests: a public partner, or an active employer
-- whose company page is on (FR-L4 data, FR-K5 AC7). A suspended company keeps its follows hidden until reinstated.
create function private.is_followable(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_public_partner(p_org) or exists (
    select 1 from public.organizations o
    where o.id = p_org and o.type = 'employer' and o.status = 'active' and o.public_page_enabled
  )
$$;

revoke all on function private.is_public_partner(uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_followable(uuid) from public, anon, authenticated, service_role;

-- The keyset cursor of the two lists, created_at|id; null when missing.
create function private.parse_created_cursor(p_cursor text) returns table (created_at timestamptz, id uuid)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_cursor is null then
    return query select null::timestamptz, null::uuid;
    return;
  end if;
  begin
    if p_cursor !~ '^[0-9T:.Z-]+\|[0-9a-f-]{36}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
    end if;
    return query select split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)::uuid;
  exception when others then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_cursor';
  end;
end;
$$;

revoke all on function private.parse_created_cursor(text) from public, anon, authenticated, service_role;

-- Saving a partner -------------------------------------------------------------------------------------------------------

-- Saves or unsaves a public partner for an employer the caller is an accepted member of (any role, FR-L4 AC1, AC2), and
-- answers whether it is saved now. p_saved null toggles; true or false sets the state, so a repeated press changes
-- nothing (FR-P2 AC8). p_org may be left out by a caller who belongs to one employer only. A change writes one audit row,
-- saved_partner.added or saved_partner.removed, on the saving organisation; a call that changes nothing writes none.
-- Unsaving works whatever the partner's state now, so a row of a partner that left the directory can still go.
--   CHARA_FORBIDDEN (42501: no session; detail release_off; no active employer of the caller), CHARA_INVALID_INPUT (detail
--   p_partner, p_org: several employers and none named, not_a_partner: the target is an employer), CHARA_NOT_FOUND (a
--   partner that is not public, to save)
create function public.toggle_saved_partner(p_partner uuid, p_org uuid default null, p_saved boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := p_org;
  v_employers uuid[];
  v_exists boolean;
  v_want boolean;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_partner is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_partner';
  end if;

  select coalesce(array_agg(a.id), '{}') into v_employers
  from private.active_org_ids() a (id)
  join public.organizations o on o.id = a.id and o.type = 'employer';
  if v_org is null then
    if cardinality(v_employers) > 1 then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'p_org';
    end if;
    v_org := v_employers[1];
  end if;
  if v_org is null or not v_org = any (v_employers) then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('saved_partner:' || v_org || ':' || p_partner, 0));
  v_exists := exists (
    select 1 from public.saved_items s where s.organization_id = v_org and s.target_organization_id = p_partner
  );
  v_want := coalesce(p_saved, not v_exists);
  if v_want = v_exists then
    return v_exists;
  end if;

  if v_want then
    if exists (select 1 from public.organizations o where o.id = p_partner and o.type = 'employer') then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'not_a_partner';
    end if;
    if not private.is_public_partner(p_partner) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.saved_items (organization_id, target_organization_id, saved_by) values (v_org, p_partner, v_uid);
    perform audit.record('saved_partner.added', 'organization', v_org::text, jsonb_build_object('partner_id', p_partner));
  else
    delete from public.saved_items s where s.organization_id = v_org and s.target_organization_id = p_partner;
    perform audit.record('saved_partner.removed', 'organization', v_org::text, jsonb_build_object('partner_id', p_partner));
  end if;
  return v_want;
end;
$$;

revoke all on function public.toggle_saved_partner(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.toggle_saved_partner(uuid, uuid, boolean) to authenticated;

-- The public partners an employer saved, newest first, in keyset pages, for its members (FR-L4 AC3, AC10). A saved
-- partner that is no longer public (suspended, hidden, declined) is left out while its row is kept. total counts the
-- partners shown over every page. Never says which organisations saved a partner.
--   p_cursor  the next_cursor of the last row of the previous page; p_limit 1 to 50, 20 when missing
--   CHARA_FORBIDDEN (42501: no session; detail release_off; not a member of the employer), CHARA_INVALID_INPUT (p_cursor)
create function public.list_saved_partners(p_org uuid, p_cursor text default null, p_limit integer default null)
returns table (
  partner_id uuid,
  slug text,
  display_name text,
  organization_type public.organization_type,
  based_in_country text,
  based_in_country_name text,
  served_countries jsonb,
  saved_at timestamptz,
  total integer,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor record;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_org is null or not exists (
    select 1 from private.member_org_ids() m (id) join public.organizations o on o.id = m.id
    where m.id = p_org and o.type = 'employer'
  ) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  select * into v_cursor from private.parse_created_cursor(p_cursor);

  select count(*)::integer into v_total
  from public.saved_items s where s.organization_id = p_org and private.is_public_partner(s.target_organization_id);

  return query
  with page as (
    select s.target_organization_id, s.created_at,
           row_number() over (order by s.created_at desc, s.target_organization_id desc) as n
    from public.saved_items s
    where s.organization_id = p_org and private.is_public_partner(s.target_organization_id)
      and (v_cursor.id is null or (s.created_at, s.target_organization_id) < (v_cursor.created_at, v_cursor.id))
    order by s.created_at desc, s.target_organization_id desc
    limit v_limit + 1
  )
  select
    o.id, o.slug, o.display_name, o.type, o.based_in_country, c.name,
    coalesce((
      select jsonb_agg(jsonb_build_object('code', g.country_code, 'name', gc.name) order by gc.name)
      from public.organization_geographies g join public.countries gc on gc.code = g.country_code
      where g.organization_id = o.id and g.scope = 'serves_market'
    ), '[]'::jsonb),
    p.created_at,
    v_total,
    case
      when p.n = v_limit and exists (select 1 from page x where x.n > v_limit)
        then to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.target_organization_id
    end
  from page p
  join public.organizations o on o.id = p.target_organization_id
  join public.countries c on c.code = o.based_in_country
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_saved_partners(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_saved_partners(uuid, text, integer) to authenticated;

-- Following a company ----------------------------------------------------------------------------------------------------

-- Follows or unfollows a company for the caller and answers whether they follow it now (FR-L4 AC4, FR-K5 AC7). Any
-- signed-in account that has chosen its kind may follow a public partner or an active employer whose page is on, except
-- its own organisation, and a member of an employer may not follow another employer (FR-K5 open point: no). p_following
-- null toggles; true or false sets the state. Unfollowing works whatever the company's state now. Not audited: the audit
-- log would keep a list of followers for six years, which the followed company and staff must not have (control "counts
-- only").
--   CHARA_FORBIDDEN (42501: no session; detail release_off, account_kind_required, employer_follows_employer),
--   CHARA_INVALID_INPUT (detail p_org, own_organization), CHARA_NOT_FOUND (a company that cannot be followed, to follow)
create function public.toggle_follow(p_org uuid, p_following boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_exists boolean;
  v_want boolean;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if private.account_kind() is null
     or exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'suspended') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'account_kind_required';
  end if;
  if p_org is null then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_org';
  end if;
  if exists (
    select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = v_uid and m.accepted_at is not null
  ) then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'own_organization';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('follow:' || v_uid || ':' || p_org, 0));
  v_exists := exists (select 1 from public.follows f where f.user_id = v_uid and f.organization_id = p_org);
  v_want := coalesce(p_following, not v_exists);
  if v_want = v_exists then
    return v_exists;
  end if;

  if v_want then
    if not private.is_followable(p_org) then
      raise exception 'CHARA_NOT_FOUND' using errcode = 'P0002';
    end if;
    if private.org_type(p_org) = 'employer' and exists (
      select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.user_id = v_uid and m.accepted_at is not null and o.type = 'employer'
    ) then
      raise exception 'CHARA_FORBIDDEN' using detail = 'employer_follows_employer';
    end if;
    insert into public.follows (user_id, organization_id) values (v_uid, p_org);
  else
    delete from public.follows f where f.user_id = v_uid and f.organization_id = p_org;
  end if;
  return v_want;
end;
$$;

revoke all on function public.toggle_follow(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.toggle_follow(uuid, boolean) to authenticated;

-- How many users follow a company, for its own accepted members only (FR-L4 AC5, AC11): {"count": n} from the setting
-- stats_min_count on, else {"count": null, "fewer_than": stats_min_count}. Never who follows.
--   CHARA_FORBIDDEN (42501: no session; detail release_off; not a member)
create function public.follower_count(p_org uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer := private.stats_min_count();
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  if p_org is null or not p_org in (select private.member_org_ids()) then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  select count(*)::integer into v_count from public.follows f where f.organization_id = p_org;
  return case
    when v_count >= v_min then jsonb_build_object('count', v_count)
    else jsonb_build_object('count', null, 'fewer_than', v_min)
  end;
end;
$$;

revoke all on function public.follower_count(uuid) from public, anon, authenticated, service_role;
grant execute on function public.follower_count(uuid) to authenticated;

-- The companies the caller follows, newest first, in keyset pages (FR-L4 AC8, AC10). A company that cannot be followed
-- now (suspended, page off, no longer listed) is left out while the follow is kept, and comes back with it. total counts
-- the companies shown over every page.
--   p_cursor  the next_cursor of the last row of the previous page; p_limit 1 to 50, 20 when missing
--   CHARA_FORBIDDEN (42501: no session; detail release_off), CHARA_INVALID_INPUT (p_cursor)
create function public.list_followed_companies(p_cursor text default null, p_limit integer default null)
returns table (
  organization_id uuid,
  slug text,
  display_name text,
  organization_type public.organization_type,
  based_in_country text,
  based_in_country_name text,
  followed_at timestamptz,
  total integer,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cursor record;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.release_on('release_partner_directories') then
    raise exception 'CHARA_FORBIDDEN' using detail = 'release_off';
  end if;
  select * into v_cursor from private.parse_created_cursor(p_cursor);

  select count(*)::integer into v_total
  from public.follows f where f.user_id = v_uid and private.is_followable(f.organization_id);

  return query
  with page as (
    select f.organization_id, f.created_at, row_number() over (order by f.created_at desc, f.organization_id desc) as n
    from public.follows f
    where f.user_id = v_uid and private.is_followable(f.organization_id)
      and (v_cursor.id is null or (f.created_at, f.organization_id) < (v_cursor.created_at, v_cursor.id))
    order by f.created_at desc, f.organization_id desc
    limit v_limit + 1
  )
  select
    o.id, o.slug, o.display_name, o.type, o.based_in_country, c.name, p.created_at, v_total,
    case
      when p.n = v_limit and exists (select 1 from page x where x.n > v_limit)
        then to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p.organization_id
    end
  from page p
  join public.organizations o on o.id = p.organization_id
  join public.countries c on c.code = o.based_in_country
  where p.n <= v_limit
  order by p.n;
end;
$$;

revoke all on function public.list_followed_companies(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_followed_companies(text, integer) to authenticated;

-- The follower digest ----------------------------------------------------------------------------------------------------

-- The first publication of a vacancy (draft to open: published_at newly set by private.jobs_guard_transition) of a
-- company with at least one follower goes to the outbox; reopening a paused or closed vacancy does not (FR-L4 AC6).
create function private.jobs_follow_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.release_on('release_partner_directories')
     and exists (select 1 from public.follows f where f.organization_id = new.organization_id) then
    insert into private.follow_activity_outbox (organization_id, entity_type, entity_id, title)
    values (new.organization_id, 'vacancy', new.id, new.title)
    on conflict (entity_type, entity_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function private.jobs_follow_activity() from public, anon, authenticated, service_role;

create trigger jobs_follow_activity
  after update of status on public.jobs
  for each row when (old.published_at is null and new.published_at is not null)
  execute function private.jobs_follow_activity();

alter table public.jobs enable always trigger jobs_follow_activity;

-- Runs hourly. Each follower of a company that can still be followed, who is active, no member of it and has had no
-- digest of it today (UTC), gets one followed_company_activity message listing the company's vacancies published since
-- their last digest (or since they followed) that are still open and visible; the follow is stamped, and the dedupe key
-- (company and day) drops a second message of the same day. The email follows the follower's choice for the kind, the
-- in-app item is always written (private.notification_enqueued). Entries older than two days have passed every digest and
-- are removed. Answers the number of messages queued; nothing while the release is off. p_now exists for the tests.
create function private.queue_follower_digests(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (p_now at time zone 'utc')::date;
  v_digest record;
  v_count integer := 0;
begin
  if not private.release_on('release_partner_directories') then
    return 0;
  end if;
  delete from private.follow_activity_outbox x where x.created_at < p_now - interval '2 days';

  for v_digest in
    select f.user_id, f.organization_id,
           (select jsonb_agg(x.entity_id order by x.created_at, x.id)
            from private.follow_activity_outbox x
            join public.jobs j on j.id = x.entity_id
            where x.organization_id = f.organization_id and x.entity_type = 'vacancy'
              and x.created_at > coalesce(f.last_digest_at, f.created_at) and x.created_at <= p_now
              and j.status = 'open' and j.deleted_at is null and j.moderation_state = 'visible') as job_ids
    from public.follows f
    join public.profiles p on p.id = f.user_id
    where (f.last_digest_at is null or (f.last_digest_at at time zone 'utc')::date < v_day)
      and p.status = 'active'
      and exists (
        select 1 from private.follow_activity_outbox x
        where x.organization_id = f.organization_id and x.created_at > coalesce(f.last_digest_at, f.created_at)
          and x.created_at <= p_now
      )
      and private.is_followable(f.organization_id)
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = f.organization_id and m.user_id = f.user_id and m.accepted_at is not null
      )
    order by f.organization_id, f.user_id
    for update of f skip locked
  loop
    if v_digest.job_ids is null then
      continue;
    end if;
    update public.follows set last_digest_at = p_now where user_id = v_digest.user_id and organization_id = v_digest.organization_id;
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'followed_company_activity', 'user_id', v_digest.user_id, 'organization_id', v_digest.organization_id,
      'job_ids', v_digest.job_ids, 'mandatory', false,
      'dedupe_key', 'followed_company_activity:' || v_digest.organization_id || ':' || v_day
    ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.queue_follower_digests(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('follower-digest', '20 * * * *', 'select private.queue_follower_digests()');

-- The payload ------------------------------------------------------------------------------------------------------------

-- The function of 20261126100000 with followed_company_activity added: the company's display name and slug and the ten
-- oldest of the vacancies of the digest by id and title, with how many there are (FR-L4 AC6: ids, titles and names only).
create or replace function private.notification_payload(p_kind text, p_message jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_title text;
  v_slug text;
  v_org_name text;
  v_invitation_id uuid;
  v_role public.member_role;
  v_expires timestamptz;
  v_decision public.partner_review_decisions;
  v_licence_id uuid;
  v_country_code text;
  v_country_name text;
  v_valid_until date;
begin
  if p_message ->> 'job_id' is not null then
    select j.id, j.title, o.slug, o.display_name into v_job_id, v_title, v_slug, v_org_name
    from public.jobs j join public.organizations o on o.id = j.organization_id
    where j.id = (p_message ->> 'job_id')::uuid;
  end if;
  if p_message ->> 'organization_id' is not null then
    select o.slug, o.display_name into v_slug, v_org_name
    from public.organizations o where o.id = (p_message ->> 'organization_id')::uuid;
  end if;
  if p_message ->> 'invitation_id' is not null then
    select i.id, i.role, i.expires_at, o.display_name into v_invitation_id, v_role, v_expires, v_org_name
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
    where i.id = (p_message ->> 'invitation_id')::uuid;
  end if;
  if p_message ->> 'decision_id' is not null then
    select * into v_decision from public.partner_review_decisions d where d.id = (p_message ->> 'decision_id')::bigint;
  end if;
  if p_message ->> 'licence_id' is not null then
    select l.id, l.country_code, c.name, l.valid_until into v_licence_id, v_country_code, v_country_name, v_valid_until
    from public.partner_licences l join public.countries c on c.code = l.country_code
    where l.id = (p_message ->> 'licence_id')::uuid;
  end if;

  return jsonb_strip_nulls(case p_kind
    when 'application_received' then case
      when p_message ? 'vacancies' then jsonb_build_object(
        'total', p_message -> 'total',
        'vacancies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', j.id, 'job_title', j.title, 'org_name', o.display_name, 'org_slug', o.slug, 'count', v.item -> 'count'
          ) order by v.position)
          from jsonb_array_elements(p_message -> 'vacancies') with ordinality as v(item, position)
          join public.jobs j on j.id = (v.item ->> 'job_id')::uuid
          join public.organizations o on o.id = j.organization_id
        ), '[]'::jsonb))
      else jsonb_build_object(
        'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name, 'org_slug', v_slug)
    end
    when 'status_changed' then jsonb_build_object(
      'application_id', p_message -> 'application_id', 'job_title', v_title, 'org_name', v_org_name,
      'status', p_message -> 'status')
    when 'vacancy_hidden' then jsonb_build_object(
      'job_id', v_job_id, 'job_title', v_title, 'org_slug', v_slug, 'reasons', p_message -> 'reasons')
    when 'trial_ending' then jsonb_build_object(
      'org_slug', v_slug, 'trial_ends_at', p_message -> 'trial_ends_at', 'plan_code', p_message -> 'plan_code',
      'plan_name', p_message -> 'plan_name',
      'amount_minor', p_message -> 'amount_minor', 'currency', p_message -> 'currency')
    when 'payment_failed' then jsonb_build_object('org_slug', v_slug)
    when 'legal_version' then jsonb_build_object(
      'document_slug', p_message -> 'document_slug', 'version', p_message -> 'version',
      'change_summary', p_message -> 'change_summary')
    when 'account_suspended' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'account_reinstated' then jsonb_build_object('reasons', p_message -> 'reasons', 'org_name', v_org_name, 'org_slug', v_slug)
    when 'member_invitation' then jsonb_build_object(
      'invitation_id', v_invitation_id, 'org_name', v_org_name, 'role', v_role, 'expires_at', v_expires)
    when 'deletion_requested' then jsonb_build_object('erases_on', p_message -> 'erases_on')
    when 'erasure_paused' then jsonb_build_object('account_id', p_message -> 'user_id')
    -- The reason of an approval stays in the staff record, as in partner_review_outcome.
    when 'partner_approved' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at)
    when 'partner_info_requested' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'info_step', v_decision.info_step, 'reason', v_decision.reason)
    when 'partner_declined' then jsonb_build_object(
      'decision_id', v_decision.id, 'org_name', v_org_name, 'org_slug', v_slug, 'decided_at', v_decision.decided_at,
      'reason', v_decision.reason)
    when 'licence_expiring' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    when 'partner_licence_expired' then jsonb_build_object(
      'licence_id', v_licence_id, 'country_code', v_country_code, 'country_name', v_country_name,
      'valid_until', v_valid_until, 'org_name', v_org_name, 'org_slug', v_slug)
    -- The ten listings confirmed longest ago are named; total says how many are due.
    when 'listing_confirmation_due' then jsonb_build_object(
      'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'listing_ids', '[]'::jsonb)),
      'stale_days', (select (s.value #>> '{}')::integer from private.settings s where s.key = 'workforce_listing_stale_days'),
      'listings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'listing_id', x.id, 'occupation', x.label, 'country_name', x.name, 'confirmed_at', x.confirmed_at
        ) order by x.confirmed_at, x.id)
        from (
          select w.id, oc.label, c.name, w.confirmed_at
          from jsonb_array_elements_text(coalesce(p_message -> 'listing_ids', '[]'::jsonb)) e(id)
          join public.workforce_availability w on w.id = e.id::uuid
          join public.occupations oc on oc.code = w.occupation_id
          join public.countries c on c.code = w.source_country
          order by w.confirmed_at, w.id
          limit 10
        ) x
      ), '[]'::jsonb))
    when 'followed_company_activity' then jsonb_build_object(
      'organization_id', p_message -> 'organization_id', 'org_name', v_org_name, 'org_slug', v_slug,
      'total', jsonb_array_length(coalesce(p_message -> 'job_ids', '[]'::jsonb)),
      'vacancies', coalesce((
        select jsonb_agg(jsonb_build_object('job_id', x.entity_id, 'job_title', x.title) order by x.position)
        from (
          select o.entity_id, o.title, e.position
          from jsonb_array_elements_text(coalesce(p_message -> 'job_ids', '[]'::jsonb)) with ordinality e(id, position)
          join private.follow_activity_outbox o on o.entity_type = 'vacancy' and o.entity_id = e.id::uuid
          order by e.position
          limit 10
        ) x
      ), '[]'::jsonb))
    else '{}'::jsonb
  end);
end;
$$;
