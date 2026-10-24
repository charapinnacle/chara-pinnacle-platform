-- The users on the current version of each required legal document, for the administration page (FR-S4 AC11 and the
-- KPI "users on the current versions"). A document of a sign-up list is counted per list: the active users whose list
-- (account kind, or partner type for a partner company user) names it, and how many of them have the current version as
-- their latest consent. An organisation-level document (the employer-pays commitment and the partner DPA, whose owner's
-- consent counts for the organisation) is counted per partner type over the active organisations of that type, with
-- the audience 'org:<type>'. The age attestation is not a document users re-accept, so it is left out. Counts only:
-- no user or organisation is named.
create function public.admin_legal_acceptance()
returns table (slug text, audience text, accepted bigint, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_staff(array['admin']::public.platform_role[]);

  return query
  with lists as (
    select e.slug, l.key as audience, private.current_legal_version(e.slug) as current_version
    from private.settings s, jsonb_each(s.value) l, jsonb_array_elements_text(l.value) e (slug)
    where s.key = 'required_consents' and e.slug <> 'age-18-plus'
  ), people as (
    select p.id, private.consent_list_key(p.account_kind, p.intended_organization_type) as audience
    from public.profiles p
    where p.account_kind is not null and p.status = 'active' and p.deleted_at is null
  )
  select l.slug, l.audience,
    count(pe.id) filter (where latest.action = 'granted' and latest.version = l.current_version),
    count(pe.id)
  from lists l
  left join people pe on pe.audience = l.audience
  left join lateral (
    select c.action, c.version from public.consents c
    where c.user_id = pe.id and c.purpose = l.slug
    order by c.id desc
    limit 1
  ) latest on true
  group by l.slug, l.audience
  union all
  select d.slug, 'org:' || t.type, count(o.id) filter (where private.org_consent_current(o.id, d.slug)), count(o.id)
  from unnest(array['employer-pays-commitment', 'partner-dpa']) d (slug)
  cross join unnest(array['recruitment_company', 'staffing_company']::public.organization_type[]) t (type)
  left join public.organizations o on o.type = t.type and o.status = 'active'
  group by d.slug, t.type
  order by 1, 2;
end;
$$;

revoke all on function public.admin_legal_acceptance() from public, anon, authenticated, service_role;
grant execute on function public.admin_legal_acceptance() to authenticated;
