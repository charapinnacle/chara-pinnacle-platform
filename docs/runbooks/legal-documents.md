# Runbook: legal documents

FR-H3 (SOP Legal Document Versioning and Publication, on every change and once a year, owner legal counsel and the Platform Administrator), design point D74 (OPEN_QUESTIONS.md), ARCHITECTURE.md sections 4 and 11. The pages are `/[lang]/legal/<slug>`, the console page is `/[lang]/admin/legal`, the work of the emails is `account-ops` (`admin-console.md`, section 3).

## 1. The process, step by step

| SOP step | Where it happens |
|---|---|
| Draft: the team prepares the structured draft and the change summary, counsel reviews and approves | Outside the system. Until counsel has approved, publish the text with the box "This text is a draft" ticked: the page shows the banner "Draft - not yet approved by legal counsel". Approval is a new version of the same text without the tick, with a change summary that says so. |
| Scope: the ten Phase 1 documents | `supabase/seeds/ref/legal_documents.sql` seeds version 0 of each as a draft placeholder. `publish_legal_document` accepts any valid slug, so a later document needs no code: its page exists as soon as its row does. Which of the eighteen documents the launch needs is an open question for CHARA (L7). |
| Review: the Platform Administrator checks formatting and links | Open `/en/legal/<slug>` after publishing; the body is plain text, a line that starts with `## ` is a heading, a blank line ends a paragraph, everything is escaped (no markup, no links are made). To check before the text is public, publish it as a draft. |
| Publish | Console, Legal documents: slug, title, text, change summary (10 to 1000 characters), draft box. The new version is the next number of the slug, published now, and cannot be changed or deleted by any API role; a correction is a new version. Two administrators who publish at once get two consecutive versions. A repeat of the current version, word for word, is refused. The audit row `legal_document.publish` carries the slug, the version, the draft mark and the change summary. |
| Trigger: re-consent at next login | `pending_reconsents()` asks a user for every document of the account kind whose current version is ahead of the user's latest consent (FR-A8, `account-emails.md` for the wording of the page). No code per document. The email `legal_version` goes, within the minute, to the active users whose latest consent for the slug is a grant of an older version. A user who never accepted the document, withdrew the consent or has asked for deletion is not told; a document nobody accepted (the cookie policy) tells nobody. |
| Display: the page shows the current version, its date (UTC) and its change summary, then the change log | `/[lang]/legal/<slug>` reads `public.v_legal_current` and the published versions of the slug (newest first, 100 at most). |
| Archive: all versions exportable for audit | Console, Legal documents, "Export all versions": a JSON file of every published version (slug, version, title, body, change_summary, is_draft, published_at). Administrator at the second step only. Keep the file with the audit archive. |

## 2. KPI: users re-consented within 30 days (%)

The ledger holds it: `consents.created_at` against `legal_documents.published_at`. For one version (here version 3 of the terms of service) the affected users are those whose latest consent before the publication was a grant of an older version; the share is of those who then granted the new version within 30 days. It is read when a version has been out for 30 days; no screen shows it in Phase 1.

```sql
with v as (
  select slug, version, published_at from public.legal_documents where slug = 'terms-of-service' and version = 3
), before as (
  select distinct on (c.user_id) c.user_id, c.action, c.version
  from public.consents c join v on c.purpose = v.slug and c.created_at < v.published_at
  order by c.user_id, c.id desc
), affected as (
  select b.user_id from before b, v where b.action = 'granted' and b.version < v.version
), done as (
  select a.user_id from affected a, v
  where exists (
    select 1 from public.consents c
    where c.user_id = a.user_id and c.purpose = v.slug and c.version = v.version and c.action = 'granted'
      and c.created_at < v.published_at + interval '30 days'
  )
)
select (select count(*) from affected) as affected, (select count(*) from done) as re_consented,
       round(100.0 * (select count(*) from done) / nullif((select count(*) from affected), 0), 1) as percent;
```

Users who erased their account are not in the ledger by their old id (FR-B6) and drop out of both counts.

## 3. Risk and controls

- Risk "unversioned changes": no API role has an insert, update or delete privilege on `public.legal_documents`; the only way to write is `publish_legal_document` (administrator at the second step), which always adds a version. The table owner (the database role used for migrations) can change a row by hand: that is a ticketed operation of the same kind as the other bootstrap statements, and the check `select slug, version from public.legal_documents group by 1, 2 having count(*) > 1` returns nothing by the primary key.
- Control "approval by legal counsel": recorded outside the system; the system records the draft mark of every version. Before go-live, no document may be current as a draft: `select slug, version from public.v_legal_current where is_draft` must return no row of the Phase 1 documents.
- Control "audit": `select count(*) from public.legal_documents d where d.version > 0 and not exists (select 1 from audit.log l where l.action = 'legal_document.publish' and l.entity_id = d.slug || ':' || d.version)` is 0 apart from the versions that a migration wrote (`platform-rules` version 1, `20261104110000_platform_rules_worker_statement.sql`); the placeholders (version 0) have no row either.
- Annual review (operational): counsel and the Platform Administrator read each current text once a year and publish a new version only where something changed.
