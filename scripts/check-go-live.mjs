#!/usr/bin/env node
// Go-live gate (FR-C6): fails when plan limits are not enforced in the environment that is about to go live.
// Usage: node scripts/check-go-live.mjs <settings.json>, where the file is the production export of private.settings
// as one JSON object (docs/runbooks/plan-limits.md, section 3). The database reads the value as text and casts it to a
// boolean, so every form Postgres reads as true means on: jsonb true, and the text true, t, yes, y, on or 1 in any case.
import { readFileSync } from 'node:fs'

const [file] = process.argv.slice(2)
if (!file) {
  process.stderr.write('Usage: node scripts/check-go-live.mjs <settings.json>\n')
  process.exit(2)
}

let settings
try {
  settings = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  process.stderr.write(`Go-live check failed: ${file} is not a readable JSON export of private.settings\n`)
  process.exit(2)
}

const enforced = settings?.entitlements_enforced
const isOn = typeof enforced === 'boolean' ? enforced : /^(t(r(ue?)?)?|y(es?)?|on|1)$/i.test(String(enforced).trim())
if (!isOn) {
  process.stderr.write(
    `Go-live check failed: entitlements_enforced must be true (found: ${enforced === undefined ? 'missing' : JSON.stringify(enforced)})\n`,
  )
  process.exit(1)
}
process.stdout.write('Go-live check passed: entitlements_enforced is on\n')
