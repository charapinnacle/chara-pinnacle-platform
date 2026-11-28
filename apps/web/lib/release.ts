// The release switches of Phase 2 (DATA_MODEL.md section 1), each a setting that is false until its release goes live; a
// missing setting counts as off. release_data_export puts the data export live on its own (FR-S3), release_chara_match
// CHARA Match, which needs release_partner_directories too (ARCHITECTURE.md section 9.3).
export const releaseSwitches = [
  "release_partner_directories",
  "release_job_orders",
  "release_candidate_submissions",
  "release_messaging",
  "release_find_workers",
  "release_data_export",
  "release_chara_match",
] as const;

export type ReleaseSwitch = (typeof releaseSwitches)[number];
