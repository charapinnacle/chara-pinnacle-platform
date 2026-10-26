// The release switches of Phase 2 (DATA_MODEL.md section 1), each a setting that is false until its release goes live; a
// missing setting counts as off.
export const releaseSwitches = [
  "release_partner_directories",
  "release_job_orders",
  "release_candidate_submissions",
  "release_messaging",
  "release_find_workers",
] as const;

export type ReleaseSwitch = (typeof releaseSwitches)[number];
