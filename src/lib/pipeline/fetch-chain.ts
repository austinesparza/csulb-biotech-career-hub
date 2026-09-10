/**
 * fetch-chain.ts — resilient fetching, so a broken source escalates itself
 * instead of waiting for an officer to notice.
 *
 * THE ONE CONSTRAINT, and the reason this file is shaped the way it is:
 * every tier returns RAW TEXT, which gets stored and content-hashed exactly as
 * before. Evidence quotes are then verified against what WE stored.
 *
 * That is why ScrapeGraphAI's `scrape` (page -> markdown) is wired in and its
 * `extract` (page -> structured JSON) is not. Extraction inside a remote API
 * leaves nothing on our side to verify a quote against, so "cited" would become
 * a vendor's assertion rather than a checked fact. Fetching is delegable.
 * Extraction is not.
 *
 * Escalation is automatic and sticky, with decay:
 *   tier 0  conditional GET      free, ~all sources, most weeks a 304
 *   tier 1  Scrapling            JS rendering + adaptive selectors
 *   tier 2  ScrapeGraphAI        hosted, handles what tier 1 cannot
 *
 * A source that fails at tier 0 is promoted and STAYS promoted, so the same
 * failure never costs a second run. After a cooling period of clean fetches it
 * demotes again, so one bad week does not make a source permanently expensive.
 */
import type { Fetcher } from "./worker";

export type FetchTier = 0 | 1 | 2;

export const TIER_NAMES: Record<FetchTier, string> = {
  0: "conditional-get",
  1: "scrapling",
  2: "scrapegraph",
};

export interface FetchOutcome {
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
  /** Which tier produced this. Recorded per fetch, so provenance survives. */
  tier: FetchTier;
  tierName: string;
  /** Tiers that were tried and failed, with why. */
  attempts: { tier: FetchTier; error: string }[];
  /** True when this run changed the source's standing tier. */
  escalated?: boolean;
  demoted?: boolean;
}

/** A tier implementation. Returns text or throws. Never extracts. */
export interface TierFetcher {
  tier: FetchTier;
  name: string;
  /** Paid tiers declare a cost so the budget guard can stop them. */
  costPerCall: number;
  fetch(url: string, opts: { etag: string | null; lastModified: string | null }): Promise<
    { status: 304 } | { status: number; body: string; etag: string | null; lastModified: string | null }
  >;
}

export interface TierState {
  sourceId: string;
  tier: FetchTier;
  /** Consecutive clean fetches at the current tier. Drives demotion. */
  cleanRuns: number;
  lastEscalatedAt?: string;
  reason?: string;
}

export interface TierStore {
  get(sourceId: string): Promise<TierState>;
  set(state: TierState): Promise<void>;
  /** Money spent on paid tiers in the current window. */
  spentThisPeriod(): Promise<number>;
}

/**
 * A response can be HTTP 200 and still be useless: a JS shell, a bot-check
 * interstitial, or a login wall. Those must escalate, not be stored as content.
 */
export function looksUnusable(body: string): string | null {
  const text = body.trim();
  if (text.length < 200) return `only ${text.length} characters returned`;

  const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length < 200) return "markup contains almost no readable text (JS-rendered shell)";

  const lower = stripped.toLowerCase();
  const blockers: [RegExp, string][] = [
    [/enable javascript to (view|continue|run)/, "page requires JavaScript"],
    [/checking your browser|just a moment|verify you are human|are you a robot/, "bot-check interstitial"],
    [/access denied|request blocked|forbidden|rate limit exceeded/, "access denied or rate limited"],
    [/sign in to continue|please log in to view/, "login wall"],
  ];
  for (const [pattern, label] of blockers) if (pattern.test(lower)) return label;
  return null;
}

/** Demote after this many consecutive clean fetches, so cost decays. */
const DEMOTE_AFTER_CLEAN_RUNS = 8;

export interface ChainOptions {
  /** Hard ceiling on paid-tier spend per period. Exceeded = stay at tier 1. */
  budgetPerPeriod?: number;
  /** Called whenever a source changes tier, for the weekly digest. */
  onTierChange?: (event: { sourceId: string; from: FetchTier; to: FetchTier; reason: string }) => void;
}

/**
 * Builds a Fetcher (the port the worker already takes) that walks the tier
 * chain. The worker does not know or care which tier answered.
 */
export function createFetchChain(
  tiers: TierFetcher[],
  store: TierStore,
  opts: ChainOptions = {},
): (sourceId: string) => Fetcher & { lastOutcome: () => FetchOutcome | null } {
  const budget = opts.budgetPerPeriod ?? Infinity;
  const ordered = [...tiers].sort((a, b) => a.tier - b.tier);

  return (sourceId: string) => {
    let lastOutcome: FetchOutcome | null = null;

    const fetcher = async (url: string, condOpts: { etag: string | null; lastModified: string | null }) => {
      const state = await store.get(sourceId);
      const attempts: { tier: FetchTier; error: string }[] = [];
      const spent = await store.spentThisPeriod();

      // Start at the source's learned tier. A source that needed Scrapling last
      // week starts there this week rather than failing at tier 0 again.
      const candidates = ordered.filter((t) => t.tier >= state.tier);

      for (const tier of candidates) {
        if (tier.costPerCall > 0 && spent + tier.costPerCall > budget) {
          attempts.push({ tier: tier.tier, error: `budget exhausted (${spent} spent, cap ${budget})` });
          continue;
        }
        try {
          const response = await tier.fetch(url, condOpts);

          if (!("body" in response)) {
            // Unchanged. Counts as a clean run: the source is behaving.
            await recordClean(state, tier.tier);
            lastOutcome = { status: 304, body: null, etag: condOpts.etag, lastModified: condOpts.lastModified, tier: tier.tier, tierName: tier.name, attempts };
            return { status: 304 as const };
          }
          if (response.status >= 400) throw new Error(`HTTP ${response.status}`);

          const unusable = looksUnusable(response.body);
          if (unusable) {
            // 200 but worthless. Escalate rather than storing a JS shell as content.
            attempts.push({ tier: tier.tier, error: unusable });
            continue;
          }

          const escalated = tier.tier > state.tier;
          if (escalated) {
            await store.set({ sourceId, tier: tier.tier, cleanRuns: 0, lastEscalatedAt: new Date().toISOString(), reason: attempts.map((a) => `${TIER_NAMES[a.tier]}: ${a.error}`).join("; ") });
            opts.onTierChange?.({ sourceId, from: state.tier, to: tier.tier, reason: attempts.at(-1)?.error ?? "lower tier failed" });
          } else {
            await recordClean(state, tier.tier);
          }

          lastOutcome = {
            status: response.status, body: response.body, etag: response.etag, lastModified: response.lastModified,
            tier: tier.tier, tierName: tier.name, attempts, escalated,
          };
          return { status: response.status, body: response.body, etag: response.etag, lastModified: response.lastModified };
        } catch (error) {
          attempts.push({ tier: tier.tier, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Every tier failed. This is the only case that still needs a human, and
      // the error names each thing that was tried.
      lastOutcome = { status: 0, body: null, etag: null, lastModified: null, tier: state.tier, tierName: TIER_NAMES[state.tier], attempts };
      throw new Error(`all fetch tiers failed: ${attempts.map((a) => `${TIER_NAMES[a.tier]} (${a.error})`).join("; ")}`);
    };

    async function recordClean(state: TierState, tier: FetchTier) {
      const cleanRuns = state.cleanRuns + 1;
      // Decay: a source that has behaved for a while drops back to the cheap tier.
      if (tier > 0 && cleanRuns >= DEMOTE_AFTER_CLEAN_RUNS) {
        const to = (tier - 1) as FetchTier;
        await store.set({ sourceId, tier: to, cleanRuns: 0, reason: `demoted after ${cleanRuns} clean runs` });
        opts.onTierChange?.({ sourceId, from: tier, to, reason: `${cleanRuns} consecutive clean fetches; trying the cheaper tier again` });
        return;
      }
      await store.set({ ...state, sourceId, tier, cleanRuns });
    }

    return Object.assign(fetcher as Fetcher, { lastOutcome: () => lastOutcome });
  };
}

/* --------------------------------------------------------------------------
   Adapters. Each returns TEXT. None of them extracts.
   -------------------------------------------------------------------------- */

/** Tier 0: what the pipeline already does. Polite, conditional, free. */
export function conditionalGetTier(rawFetch: Fetcher): TierFetcher {
  return { tier: 0, name: "conditional-get", costPerCall: 0, fetch: rawFetch };
}

/**
 * Tier 1: Scrapling. Runs locally, handles JS rendering and adaptive selectors.
 * `call` is injected so this file has no hard dependency and stays testable.
 */
export function scraplingTier(call: (url: string) => Promise<string>): TierFetcher {
  return {
    tier: 1, name: "scrapling", costPerCall: 0,
    async fetch(url) {
      const body = await call(url);
      return { status: 200, body, etag: null, lastModified: null };
    },
  };
}

/**
 * Tier 2: ScrapeGraphAI, `scrape` only -- page to markdown.
 *
 * Deliberately NOT its `extract` tool. Extraction must run against text we
 * stored, or the evidence check has nothing to check against.
 */
export function scrapeGraphTier(call: (url: string) => Promise<string>, costPerCall = 0.01): TierFetcher {
  return {
    tier: 2, name: "scrapegraph", costPerCall,
    async fetch(url) {
      const body = await call(url);
      return { status: 200, body, etag: null, lastModified: null };
    },
  };
}
