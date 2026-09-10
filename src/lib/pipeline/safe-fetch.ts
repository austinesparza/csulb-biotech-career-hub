/**
 * safe-fetch.ts — fetching URLs that strangers submitted.
 *
 * Threat: someone submits http://169.254.169.254/latest/meta-data/ or
 * http://10.0.0.5:5432 and your worker happily fetches it from inside your
 * network. This module blocks that.
 *
 * Residual risk worth knowing: DNS rebinding. We resolve, validate, then fetch
 * by hostname, so a hostile resolver could return a public IP to us and a
 * private one to the fetch. Closing that fully requires connecting to the
 * pinned IP with a Host header via a custom agent. For a club worker running
 * a handful of officer-visible fetches, resolve-then-check plus per-hop
 * revalidation is a reasonable stopping point -- but do not reuse this module
 * for anything higher-stakes without pinning.
 */
import dns from "node:dns/promises";
import net from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const MAX_REDIRECTS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Private, loopback, link-local, CGNAT, multicast, reserved. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 10) return true;                       // private
    if (a === 127) return true;                      // loopback
    if (a === 169 && b === 254) return true;         // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;// private
    if (a === 192 && b === 168) return true;         // private
    if (a === 192 && b === 0) return true;           // 192.0.0/24 special
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                       // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80")) return true;           // link-local
    if (/^f[cd]/.test(v)) return true;               // unique local fc00::/7
    // IPv4-mapped (::ffff:10.0.0.1) -- unwrap and recheck
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // unparseable -> block
}

export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("not a valid URL", raw);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BlockedUrlError(`protocol ${url.protocol} not allowed`, raw);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("credentials in URL not allowed", raw);
  }
  // A bare IP literal skips DNS; check it directly.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError(`address ${host} is in a blocked range`, raw);
    return url;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`cannot resolve ${host}`, raw);
  }
  if (records.length === 0) throw new BlockedUrlError(`no address for ${host}`, raw);
  for (const { address } of records) {
    if (isBlockedIp(address)) {
      throw new BlockedUrlError(`${host} resolves to blocked address ${address}`, raw);
    }
  }
  return url;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  body: string;
}

export type SafeFetchResponse = SafeFetchResult | { status: 304; finalUrl: string };

interface InternalFetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  userAgent?: string;
  /** Only used by a source-specific wrapper after it validates the target. */
  headers?: Record<string, string>;
  /** Prevents credentials from following a redirect outside one origin/path. */
  restrictOrigin?: string;
  restrictPath?: string;
}

/**
 * Fetch with redirects followed manually so every hop is revalidated.
 * Sends a club-identifying User-Agent and never attaches credentials.
 */
export async function safeFetch(
  raw: string,
  opts: { etag?: string | null; lastModified?: string | null; userAgent?: string } = {},
): Promise<SafeFetchResponse> {
  return safeFetchInternal(raw, opts);
}

async function safeFetchInternal(raw: string, opts: InternalFetchOptions): Promise<SafeFetchResponse> {
  const ua =
    opts.userAgent ??
    "CSULBBiotechClubHub/1.0 (student resource; contact csubiotechclub@gmail.com)";
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafePublicUrl(current);
    if (
      (opts.restrictOrigin && url.origin.toLowerCase() !== opts.restrictOrigin) ||
      (opts.restrictPath && url.pathname.toLowerCase() !== opts.restrictPath)
    ) {
      throw new BlockedUrlError(`redirect target ${url.origin}${url.pathname} is not allowed for this authenticated request`, current);
    }
    const headers: Record<string, string> = {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
      ...opts.headers,
    };
    if (opts.etag) headers["If-None-Match"] = opts.etag;
    if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers,
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 304) return { status: 304, finalUrl: url.toString() };

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new BlockedUrlError("redirect without location", current);
      current = new URL(location, url).toString();
      continue;
    }

    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new BlockedUrlError(`response too large (${length} bytes)`, current);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new BlockedUrlError("response too large", current);

    return {
      finalUrl: url.toString(),
      status: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      body: new TextDecoder().decode(buffer),
    };
  }
  throw new BlockedUrlError("too many redirects", raw);
}

export interface UsaJobsCredentials {
  /** API key issued by developer.usajobs.gov. Keep server-side. */
  apiKey: string;
  /** Email used to register the key. USAJOBS requires it as User-Agent. */
  registeredEmail: string;
}

function singleLine(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) throw new Error(`${label} must be a non-empty single line`);
  return trimmed;
}

/**
 * Source-specific USAJOBS fetcher. Credentials are accepted only for the
 * documented HTTPS search endpoint and can never follow a cross-host redirect.
 */
export function createUsaJobsFetcher(credentials: UsaJobsCredentials) {
  const apiKey = singleLine(credentials.apiKey, "USAJOBS API key");
  const registeredEmail = singleLine(credentials.registeredEmail, "USAJOBS registered email");

  return async (
    raw: string,
    opts: { etag: string | null; lastModified: string | null },
  ): Promise<SafeFetchResponse> => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BlockedUrlError("not a valid USAJOBS URL", raw);
    }
    if (
      url.protocol !== "https:" ||
      url.origin.toLowerCase() !== "https://data.usajobs.gov" ||
      url.pathname.toLowerCase() !== "/api/search"
    ) {
      throw new BlockedUrlError("USAJOBS credentials may only be sent to https://data.usajobs.gov/api/Search", raw);
    }

    return safeFetchInternal(url.toString(), {
      ...opts,
      userAgent: registeredEmail,
      headers: { "Authorization-Key": apiKey },
      restrictOrigin: "https://data.usajobs.gov",
      restrictPath: "/api/search",
    });
  };
}
