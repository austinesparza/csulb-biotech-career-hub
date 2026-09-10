import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { assertSafePublicUrl } from "./safe-fetch";

const execFile = promisify(execFileCallback);
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const SCRAPLING_TIMEOUT_MS = 45_000;
const SCRAPEGRAPH_TIMEOUT_MS = 45_000;

type ExecFilePort = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr?: string }>;

function enforceTextLimit(text: string, label: string): string {
  if (!text.trim()) throw new Error(`${label} returned an empty document`);
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    throw new Error(`${label} returned more than ${MAX_TEXT_BYTES} bytes`);
  }
  return text;
}

export function createScraplingClient(options: {
  cwd?: string;
  execFile?: ExecFilePort;
  timeoutMs?: number;
} = {}): (rawUrl: string) => Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const call = options.execFile ?? (execFile as ExecFilePort);
  const timeout = options.timeoutMs ?? SCRAPLING_TIMEOUT_MS;

  return async (rawUrl: string) => {
    const url = await assertSafePublicUrl(rawUrl);
    const python = path.join(cwd, ".tools", "scraping", "bin", "python");
    const helper = path.join(cwd, "scripts", "tools", "scrapling-fetch.py");
    const result = await call(python, [helper, url.toString()], {
      cwd,
      timeout,
      maxBuffer: MAX_TEXT_BYTES,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        LANG: process.env.LANG ?? "C.UTF-8",
        LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
        TMPDIR: process.env.TMPDIR,
        PLAYWRIGHT_BROWSERS_PATH: path.join(cwd, ".tools", "browsers"),
      },
    });
    return enforceTextLimit(result.stdout, "Scrapling");
  };
}

interface ScrapeGraphResponse {
  results?: {
    markdown?: { data?: unknown };
  };
  data?: {
    results?: {
      markdown?: { data?: unknown };
    };
  };
}

function markdownFromResponse(payload: ScrapeGraphResponse): string | null {
  const candidate = payload.results?.markdown?.data ?? payload.data?.results?.markdown?.data;
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) {
    const first = candidate[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "content" in first && typeof first.content === "string") {
      return first.content;
    }
  }
  return null;
}

export function createScrapeGraphClient(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
} = {}): (rawUrl: string) => Promise<string> {
  const apiKey = options.apiKey ?? process.env.SCRAPEGRAPH_API_KEY;
  if (!apiKey?.trim()) throw new Error("SCRAPEGRAPH_API_KEY is required for the hosted scrape tier");
  const fetchFn = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? "https://v2-api.scrapegraphai.com/api/scrape";
  const timeout = options.timeoutMs ?? SCRAPEGRAPH_TIMEOUT_MS;

  return async (rawUrl: string) => {
    const url = await assertSafePublicUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "SGAI-APIKEY": apiKey,
          "User-Agent": "CSULBBiotechClubHub/1.0 (student resource; contact csubiotechclub@gmail.com)",
        },
        body: JSON.stringify({
          url: url.toString(),
          formats: [{ type: "markdown" }],
          fetchConfig: { mode: "js", stealth: false },
        }),
      });
      if (!response.ok) throw new Error(`ScrapeGraphAI scrape failed with HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_TEXT_BYTES) throw new Error("ScrapeGraphAI response is too large");
      const body = await response.text();
      enforceTextLimit(body, "ScrapeGraphAI response");
      const markdown = markdownFromResponse(JSON.parse(body) as ScrapeGraphResponse);
      if (!markdown) throw new Error("ScrapeGraphAI response contained no markdown");
      return enforceTextLimit(markdown, "ScrapeGraphAI");
    } finally {
      clearTimeout(timer);
    }
  };
}
