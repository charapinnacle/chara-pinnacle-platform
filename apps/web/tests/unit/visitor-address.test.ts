import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientAddress, visitorKey } from "@/lib/visitor-address";

describe("clientAddress", () => {
  it("takes the entry the single trusted proxy appended, however many the client sent before it", () => {
    expect(clientAddress("198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientAddress("6.6.6.6, 1.1.1.1, 198.51.100.7", 1)).toBe("198.51.100.7");
  });

  it("ignores a spoofed leftmost entry: a client cannot choose its own address", () => {
    expect(clientAddress("203.0.113.99, 198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientAddress("203.0.113.99, 198.51.100.7", 1)).not.toBe("203.0.113.99");
  });

  it("counts the number of trusted hops from the right", () => {
    const header = "6.6.6.6, 198.51.100.7, 10.0.0.2";
    expect(clientAddress(header, 1)).toBe("10.0.0.2");
    expect(clientAddress(header, 2)).toBe("198.51.100.7");
    expect(clientAddress(header, 3)).toBe("6.6.6.6");
  });

  it("has no address when the header is missing or shorter than the hop count", () => {
    expect(clientAddress(null, 1)).toBeNull();
    expect(clientAddress("", 1)).toBeNull();
    expect(clientAddress("198.51.100.7", 2)).toBeNull();
  });

  it("has no address when the trusted entry is not an IP address", () => {
    expect(clientAddress("198.51.100.7, unknown", 1)).toBeNull();
    expect(clientAddress("198.51.100.7, <script>", 1)).toBeNull();
    expect(clientAddress("999.1.1.1", 1)).toBeNull();
  });

  it("tolerates spaces, a port and brackets that proxies add", () => {
    expect(clientAddress("  198.51.100.7:51234 ", 1)).toBe("198.51.100.7");
    expect(clientAddress("[2001:db8:1:2:3:4:5:6]:443", 1)).toBe("2001:0db8:0001:0002::/64");
  });

  it("counts an IPv6 visitor by its /64, so one subscriber cannot take a new budget with each address", () => {
    const first = clientAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 1);
    const second = clientAddress("2001:DB8:1:2::1", 1);
    expect(first).toBe("2001:0db8:0001:0002::/64");
    expect(second).toBe(first);
    expect(clientAddress("2001:db8:1:3::1", 1)).not.toBe(first);
  });

  it("reads compressed, loopback and zoned IPv6 forms", () => {
    expect(clientAddress("::1", 1)).toBe("0000:0000:0000:0000::/64");
    expect(clientAddress("::", 1)).toBe("0000:0000:0000:0000::/64");
    expect(clientAddress("fe80::1%en0", 1)).toBe("fe80:0000:0000:0000::/64");
    expect(clientAddress("2001:db8::", 1)).toBe("2001:0db8:0000:0000::/64");
  });

  it("counts an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(clientAddress("::ffff:198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientAddress("::ffff:c633:6407", 1)).toBe("198.51.100.7");
  });
});

describe("visitorKey", () => {
  const secret = "test-visitor-hash-secret-0123456789abcdef";

  it("is the HMAC-SHA256 of the address under the secret, as 64 hex characters", () => {
    const key = visitorKey(secret, "198.51.100.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(createHmac("sha256", secret).update("198.51.100.7").digest("hex"));
  });

  it("never contains the address", () => {
    expect(visitorKey(secret, "198.51.100.7")).not.toContain("198");
  });

  it("is stable for one address and differs between addresses and between secrets", () => {
    expect(visitorKey(secret, "198.51.100.7")).toBe(visitorKey(secret, "198.51.100.7"));
    expect(visitorKey(secret, "198.51.100.7")).not.toBe(visitorKey(secret, "198.51.100.8"));
    expect(visitorKey(secret, "198.51.100.7")).not.toBe(visitorKey(`${secret}x`, "198.51.100.7"));
  });

  it("gives visitors without an address one shared key that no address produces", () => {
    expect(visitorKey(secret, null)).toBe(visitorKey(secret, null));
    expect(visitorKey(secret, null)).not.toBe(visitorKey(secret, "198.51.100.7"));
    expect(visitorKey(secret, null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
