-- The label of the data export switch (V29, FR-S3 AC7) names what the release does without the word of the page it opens:
-- the Change button of the console carries the label, and a button named "... Download ..." on a staff page reads as a
-- way to a user's file (FR-F3 AC8, tests/e2e/staff-document-denial.spec.ts).
update private.setting_rules
set label = 'Data export: a user exports a copy of their own data'
where key = 'release_data_export';
