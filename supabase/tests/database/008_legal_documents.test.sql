begin;
select plan(21);

select has_table('public', 'legal_documents', 'legal_documents exists');
select columns_are(
  'public', 'legal_documents',
  array['slug', 'version', 'title', 'body', 'change_summary', 'published_at', 'is_draft'],
  'legal_documents has the SDD columns and the draft mark'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.legal_documents'::regclass),
  'legal_documents has RLS enabled and forced'
);

select set_eq(
  $$select slug from public.legal_documents where version = 0$$,
  $$values
    ('account-suspension-and-termination-rules'), ('acceptable-use-policy'), ('age-18-plus'), ('complaints-and-dispute-process'),
    ('cookie-policy'), ('employer-terms'), ('platform-rules'), ('privacy-policy'),
    ('sharing-notice'), ('subscription-and-billing-terms'), ('terms-of-service'), ('worker-terms')$$,
  'version 0 exists for every Phase 1 legal document and the age attestation'
);
select is_empty(
  $$select 1 from public.legal_documents where version = 0 and (title not like 'DRAFT%' or published_at is null or not is_draft)$$,
  'every seeded placeholder is published and marked DRAFT'
);

-- Unique and validated
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
    values ('terms-of-service', 0, 'Duplicate', 'x', 'A duplicate version.', now())$$,
  '23505', null, 'a slug and version pair is unique'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('Terms', 1, 'Terms', 'x', 'Uppercase slug refused.')$$,
  '23514', null, 'a slug with a capital letter is refused'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('terms--of-use', 1, 'Terms', 'x', 'Double hyphen refused.')$$,
  '23514', null, 'a slug with a double hyphen is refused'
);
select throws_ok(
  format($$insert into public.legal_documents (slug, version, title, body, change_summary)
    values (%L, 1, 'Terms', 'x', 'Long slug refused.')$$, repeat('a', 81)),
  '23514', null, 'a slug of 81 characters is refused'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('terms-of-use', -1, 'Terms', 'x', 'Negative version.')$$,
  '23514', null, 'a negative version is refused'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('terms-of-use', 1, 'Te', 'x', 'Short title refused.')$$,
  '23514', null, 'a title of 2 characters is refused'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('terms-of-use', 1, 'Terms', '', 'Empty body refused.')$$,
  '23514', null, 'an empty body is refused'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary)
    values ('terms-of-use', 1, 'Terms', 'x', 'Too short')$$,
  '23514', null, 'a change summary of 9 characters is refused'
);

-- Publication state and the current version
insert into public.legal_documents (slug, version, title, body, change_summary, published_at) values
  ('terms-of-use', 1, 'Terms of Use', 'Version one', 'The first published version.', now() - interval '2 days'),
  ('terms-of-use', 2, 'Terms of Use', 'Version two', 'The second published version.', now() - interval '1 day');
insert into public.legal_documents (slug, version, title, body, change_summary) values
  ('terms-of-use', 3, 'Terms of Use', 'Version three', 'An unpublished draft version.');
insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
values ('terms-of-use', 4, 'Terms of Use', 'Version four', 'A version dated in the future.', now() + interval '1 day');

select is(
  private.current_legal_version('terms-of-use'), 2,
  'the current version is the highest published version; unpublished and future-dated rows do not count'
);
select is(private.current_legal_version('no-such-document'), null, 'a slug without a published row has no current version');

set local role anon;
select results_eq(
  $$select version from public.legal_documents where slug = 'terms-of-use' order by version$$,
  $$values (1), (2)$$,
  'anon reads published versions only, not an unpublished or a future-dated one'
);
select is(
  (select count(*) from public.legal_documents where slug = 'privacy-policy'),
  1::bigint,
  'anon reads the seeded published placeholder'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
select is_empty(
  $$select 1 from public.legal_documents where published_at is null$$,
  'authenticated users do not read unpublished versions'
);
reset role;

-- No API role writes
select ok(
  not has_table_privilege('anon', 'public.legal_documents', 'insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.legal_documents', 'insert, update, delete, truncate')
  and not has_table_privilege('service_role', 'public.legal_documents', 'select, insert, update, delete, truncate')
  and not has_any_column_privilege('anon', 'public.legal_documents', 'insert, update')
  and not has_any_column_privilege('authenticated', 'public.legal_documents', 'insert, update')
  and not has_any_column_privilege('service_role', 'public.legal_documents', 'select, insert, update'),
  'no API role can write legal_documents and service_role cannot read it'
);
set local role authenticated;
select throws_ok(
  $$update public.legal_documents set body = 'tampered' where slug = 'terms-of-use'$$,
  '42501', null, 'authenticated cannot edit a published version'
);
select throws_ok(
  $$insert into public.legal_documents (slug, version, title, body, change_summary, published_at)
    values ('terms-of-use', 9, 'Terms', 'x', 'Forged version here.', now())$$,
  '42501', null, 'authenticated cannot insert a version'
);
reset role;

select * from finish();
rollback;
