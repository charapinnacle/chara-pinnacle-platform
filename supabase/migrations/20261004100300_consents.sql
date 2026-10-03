-- Consent ledger (ARCHITECTURE.md sections 4, 12; OPEN_QUESTIONS.md D3, L9). The purpose of a consent is the slug
-- of the legal document it accepts. consents is append-only: a withdrawal is a new row, and rows are written by
-- accept_consents and withdraw_consent only. user_id has no foreign key so the evidence outlives the account.

create type public.consent_action as enum ('granted', 'withdrawn');

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  purpose text not null,
  version integer not null,
  action public.consent_action not null,
  created_at timestamptz not null default now(),
  foreign key (purpose, version) references public.legal_documents (slug, version)
);

create index consents_user_purpose_idx on public.consents (user_id, purpose, id desc);

alter table public.consents enable row level security;
alter table public.consents force row level security;

grant select on public.consents to authenticated;

create policy consents_select_own on public.consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create function private.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger consents_append_only
  before update or delete on public.consents
  for each row execute function private.refuse_change();

create trigger consents_no_truncate
  before truncate on public.consents
  for each statement execute function private.refuse_change();

-- ENABLE ALWAYS so session_replication_role = replica cannot bypass the append-only rule.
alter table public.consents enable always trigger consents_append_only;
alter table public.consents enable always trigger consents_no_truncate;

-- Documents whose acceptance is recorded when the account kind is committed, per kind (L9: to be confirmed by CHARA).
-- A document listed only for the other kind cannot be accepted by a user of this kind.
insert into private.settings (key, value) values (
  'required_consents',
  '{
    "worker": ["terms-of-service", "privacy-policy", "worker-terms", "age-18-plus"],
    "company": ["terms-of-service", "privacy-policy", "employer-terms"]
  }'
);

create function private.required_consents(p_kind public.account_kind) returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(e) from jsonb_array_elements_text((s.value #>> '{}')::jsonb -> p_kind::text) e),
    '{}'
  )
  from private.settings s
  where s.key = 'required_consents'
$$;

revoke all on function private.required_consents(public.account_kind) from public, anon, authenticated, service_role;

-- Records acceptance of the current version of each document in p_consents ([{purpose, version}]) for the caller.
-- A document the caller already holds a granted row for at that version is skipped, so a repeat call is a no-op.
create function public.accept_consents(p_consents jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind public.account_kind;
  v_other public.account_kind;
  v_entry jsonb;
  v_purpose text;
  v_version integer;
  v_recorded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The row lock serialises concurrent calls of one user, so the idempotency check below cannot race.
  select coalesce(p.account_kind, p.intended_account_kind) into v_kind
  from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;
  v_other := (case v_kind when 'worker' then 'company' else 'worker' end)::public.account_kind;

  if jsonb_typeof(p_consents) is distinct from 'array' or jsonb_array_length(p_consents) > 20 then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'p_consents must be an array of at most 20 entries';
  end if;

  for v_entry in select e from jsonb_array_elements(p_consents) e loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or jsonb_typeof(v_entry -> 'purpose') is distinct from 'string'
       or (v_entry ->> 'version') !~ '^[0-9]{1,9}$' then
      raise exception 'CHARA_INVALID_INPUT' using detail = 'each entry needs a purpose and an integer version';
    end if;
    v_purpose := v_entry ->> 'purpose';
    v_version := (v_entry ->> 'version')::integer;

    if v_purpose = any (private.required_consents(v_other))
       and v_purpose <> all (private.required_consents(v_kind)) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;
    if v_version is distinct from private.current_legal_version(v_purpose) then
      raise exception 'CHARA_INVALID_INPUT' using detail = v_purpose;
    end if;

    if exists (
      select 1 from (
        select c.action, c.version from public.consents c
        where c.user_id = v_uid and c.purpose = v_purpose
        order by c.id desc limit 1
      ) latest
      where latest.action = 'granted' and latest.version = v_version
    ) then
      continue;
    end if;

    insert into public.consents (user_id, purpose, version, action)
    values (v_uid, v_purpose, v_version, 'granted');
    v_recorded := v_recorded || jsonb_build_object('purpose', v_purpose, 'version', v_version);
  end loop;

  if jsonb_array_length(v_recorded) > 0 then
    perform audit.record('consents_accepted', 'profile', v_uid::text, jsonb_build_object('consents', v_recorded));
  end if;
end;
$$;

revoke all on function public.accept_consents(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.accept_consents(jsonb) to authenticated;

-- Withdraws the caller's latest granted consent for p_purpose by appending a 'withdrawn' row for that version.
create function public.withdraw_consent(p_purpose text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_action public.consent_action;
  v_version integer;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  -- The age attestation (FR-A9) is never undone.
  if p_purpose = 'age-18-plus' then
    raise exception 'CHARA_INVALID_INPUT' using detail = p_purpose;
  end if;

  select c.action, c.version into v_action, v_version
  from public.consents c
  where c.user_id = v_uid and c.purpose = p_purpose
  order by c.id desc limit 1;
  if not found or v_action <> 'granted' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'no granted consent for ' || coalesce(p_purpose, 'null');
  end if;

  insert into public.consents (user_id, purpose, version, action)
  values (v_uid, p_purpose, v_version, 'withdrawn');
  perform audit.record(
    'consent_withdrawn', 'profile', v_uid::text,
    jsonb_build_object('purpose', p_purpose, 'version', v_version)
  );
end;
$$;

revoke all on function public.withdraw_consent(text) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_consent(text) to authenticated;
