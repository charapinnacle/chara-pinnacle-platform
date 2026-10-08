const encoder = new TextEncoder();

export interface Archive {
  // false when an object with this key is already there: the archive never overwrites.
  put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<boolean>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // The object lock of every file: it cannot be shortened or deleted before this many days have passed.
  retainDays: number;
}

export class ArchiveError extends Error {
  // The status of the archive and nothing else: its text can name the bucket and the key.
  constructor(readonly status: number) {
    super(`archive_${status}`);
  }
}

const PUT_TIMEOUT_MS = 60_000;
const HOUR_MS = 3_600_000;

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const sha256 = (data: Uint8Array<ArrayBuffer> | string) =>
  crypto.subtle.digest("SHA-256", typeof data === "string" ? encoder.encode(data) : data);

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

// AWS Signature Version 4 of a request without a query string. `headers` are the lower-case headers to sign besides host.
export async function signature(
  config: Pick<S3Config, "region" | "accessKeyId" | "secretAccessKey">,
  request: {
    method: string;
    host: string;
    path: string;
    headers: Record<string, string>;
    payloadHash: string;
    amzDate: string;
  },
): Promise<string> {
  const all: Record<string, string> = { ...request.headers, host: request.host };
  const names = Object.keys(all).sort();
  const canonical = [
    request.method,
    request.path,
    "",
    ...names.map((name) => `${name}:${all[name].trim()}`),
    "",
    names.join(";"),
    request.payloadHash,
  ].join("\n");
  const day = request.amzDate.slice(0, 8);
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", request.amzDate, scope, hex(await sha256(canonical))].join("\n");
  let key: ArrayBuffer | Uint8Array<ArrayBuffer> = encoder.encode(`AWS4${config.secretAccessKey}`);
  for (const part of [day, config.region, "s3", "aws4_request"]) {
    key = await hmac(key, part);
  }
  return `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${
    hex(await hmac(key, toSign))
  }`;
}

const isoBasic = (date: Date): string => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// An S3-compatible bucket with Object Lock in compliance mode. The object is written only if the key is free
// (If-None-Match), with the retention date of the lock and the checksum of the body, which the store verifies.
export function s3Archive(
  config: S3Config,
  deps: { fetch: typeof fetch; now: () => Date } = { fetch, now: () => new Date() },
): Archive {
  const host = new URL(config.endpoint).host;
  return {
    async put(key, body, contentType) {
      const now = deps.now();
      const digest = await sha256(body);
      const path = `/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
      const headers: Record<string, string> = {
        "content-type": contentType,
        "if-none-match": "*",
        "x-amz-checksum-sha256": base64(digest),
        "x-amz-content-sha256": hex(digest),
        "x-amz-date": isoBasic(now),
        "x-amz-object-lock-mode": "COMPLIANCE",
        "x-amz-object-lock-retain-until-date": new Date(now.getTime() + config.retainDays * 24 * HOUR_MS).toISOString(),
      };
      const authorization = await signature(config, {
        method: "PUT",
        host,
        path,
        headers,
        payloadHash: headers["x-amz-content-sha256"],
        amzDate: headers["x-amz-date"],
      });
      const response = await deps.fetch(`${config.endpoint.replace(/\/$/, "")}${path}`, {
        method: "PUT",
        headers: { ...headers, authorization },
        body,
        signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
      });
      if (response.status === 412) {
        return false;
      }
      if (!response.ok) {
        throw new ArchiveError(response.status);
      }
      return true;
    },
  };
}
