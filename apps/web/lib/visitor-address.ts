import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

const UNKNOWN = "unknown";

function stripDecoration(entry: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  if (bracketed) return bracketed[1].split("%")[0];
  if (/^[^:]+:\d+$/.test(entry)) return entry.split(":")[0];
  return entry.split("%")[0];
}

function groupsOf(v6: string): string[] {
  const canonical = new URL(`http://[${v6}]`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const gap = Array<string>(8 - front.length - back.length).fill("0");
  return [...front, ...(tail === undefined ? [] : gap), ...back].map((group) => group.padStart(4, "0"));
}

// One visitor per IPv4 address, and one per IPv6 /64: a single subscriber holds 2^64 addresses and could
// otherwise take a fresh budget with each one. An IPv4-mapped IPv6 address counts as its IPv4 address.
function normalise(entry: string): string | null {
  const address = stripDecoration(entry.trim());
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return null;
  const groups = groupsOf(address);
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const high = parseInt(groups[6], 16);
    const low = parseInt(groups[7], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

// The app runs behind `trustedHops` reverse proxies and is not reachable except through them. Each of them appends
// the address of the connection it accepted to X-Forwarded-For, so the entry `trustedHops` places from the right is
// the one our own infrastructure wrote; every entry to its left came from the client and is ignored.
// Returns null when the header is missing, shorter than the hop count or does not hold an IP address there.
export function clientAddress(forwardedFor: string | null, trustedHops: number): string | null {
  const entries = forwardedFor?.split(",") ?? [];
  const entry = entries[entries.length - trustedHops];
  return entry === undefined ? null : normalise(entry);
}

// Visitors without an address share one key rather than none: refusing them all is safer than not counting them.
export function visitorKey(secret: string, address: string | null): string {
  return createHmac("sha256", secret)
    .update(address ?? UNKNOWN)
    .digest("hex");
}
