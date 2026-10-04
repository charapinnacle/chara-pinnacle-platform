import { randomInt } from "node:crypto";
import { expect, test as base } from "@playwright/test";

export { expect };

// The server counts attempts per visitor and takes the visitor from X-Forwarded-For (TRUSTED_PROXY_HOPS=1: the browser
// tests play the proxy), so each test is its own visitor and the tests do not use up one another's budgets.
export function visitorAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": visitorAddress() });
  },
});
