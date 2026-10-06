#!/usr/bin/env node
// Go-live gate (FR-C6): fails when plan limits are not enforced in the environment that is about to go live.
// Usage: node scripts/check-go-live.mjs <settings.json>, where the file is the production export of private.settings
// as one JSON object (docs/runbooks/plan-limits.md, section 3). The database reads the value as text and casts it to a
// boolean, so both the stored jsonb true and the jsonb string "true" mean on.
import { readFileSync } from 'node:fs'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/check-go-live.mjs <settings.json>')
  process.exit(2)
}

let settings
try {
  settings = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  console.error(`Go-live check failed: ${file} is not a readable JSON export of private.settings`)
  process.exit(2)
}

const enforced = settings?.entitlements_enforced
if (enforced !== true && enforced !== 'true') {
  console.error(`Go-live check failed: entitlements_enforced must be true (found: ${enforced === undefined ? 'missing' : JSON.stringify(enforced)})`)
  process.exit(1)
}
console.log('Go-live check passed: entitlements_enforced is on')
