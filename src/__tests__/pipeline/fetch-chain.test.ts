import { createFetchChain, conditionalGetTier, scraplingTier, scrapeGraphTier, looksUnusable, type TierStore, type TierState } from "../../lib/pipeline/fetch-chain";
import type { Fetcher } from "../../lib/pipeline/worker";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };

const GOOD_PAGE = "Summer 2027 Internship. ".repeat(20) + "Applicants must be currently enrolled in a Master's program. A minimum GPA of 3.0 is required.";

function makeStore(initial: Partial<TierState> = {}) {
  const states = new Map<string, TierState>();
  let spent = 0;
  const store: TierStore = {
    async get(sourceId) { return states.get(sourceId) ?? { sourceId, tier: 0, cleanRuns: 0, ...initial }; },
    async set(state) { states.set(state.sourceId, state); },
    async spentThisPeriod() { return spent; },
  };
  return { store, states, addSpend: (n: number) => { spent += n; } };
}

console.log("=== Detecting a 200 that is actually useless ===\n");
ok("JS shell caught", looksUnusable('<html><body><div id="root"></div><script>var a=1;'.padEnd(600, "x") + "</script></body></html>") !== null,
   String(looksUnusable('<html><body><div id="root"></div><script>' + "x".repeat(600) + "</script></body></html>")));
ok("bot-check interstitial caught", /bot-check/.test(looksUnusable("Just a moment... Checking your browser before accessing. ".repeat(10)) ?? ""));
ok("access denied caught", /access denied/.test(looksUnusable("Access Denied. ".repeat(30)) ?? ""));
ok("login wall caught", /login wall/.test(looksUnusable("Please log in to view this content. ".repeat(20)) ?? ""));
ok("enable-javascript notice caught", /JavaScript/.test(looksUnusable("You must enable javascript to view this page. ".repeat(20)) ?? ""));
ok("tiny response caught", looksUnusable("short") !== null);
ok("a real page passes", looksUnusable(GOOD_PAGE) === null, String(looksUnusable(GOOD_PAGE)));

console.log("\n=== Tier 0 succeeds: nothing else runs ===\n");
{
  const { store, states } = makeStore();
  let scraplingCalls = 0, graphCalls = 0;
  const t0: Fetcher = async () => ({ status: 200, body: GOOD_PAGE, etag: 'W/"1"', lastModified: null });
  const chain = createFetchChain(
    [conditionalGetTier(t0), scraplingTier(async () => { scraplingCalls++; return GOOD_PAGE; }), scrapeGraphTier(async () => { graphCalls++; return GOOD_PAGE; })],
    store,
  );
  const f = chain("src-1");
  const r = await f("https://x", { etag: null, lastModified: null });
  ok("returns the page", "body" in r && r.body === GOOD_PAGE);
  ok("no fallback invoked", scraplingCalls === 0 && graphCalls === 0);
  ok("tier recorded as 0", f.lastOutcome()!.tier === 0);
  ok("source stays at tier 0", states.get("src-1")!.tier === 0);
}

console.log("\n=== Tier 0 returns a JS shell: escalates and STAYS escalated ===\n");
{
  const { store, states } = makeStore();
  const events: any[] = [];
  let scraplingCalls = 0, t0Calls = 0;
  // A realistic JS shell: plenty of bytes, almost no readable text. This is
  // what a university portal returns after a React rewrite.
  const JS_SHELL = `<!doctype html><html><head><title>Portal</title>
    <link rel="stylesheet" href="/static/css/main.8f2a1b.css">
  </head><body><div id="root"></div>
  <script src="/static/js/runtime.${"a".repeat(400)}.js"></script>
  <script src="/static/js/vendor.${"b".repeat(400)}.js"></script>
  </body></html>`;
  const t0: Fetcher = async () => { t0Calls++; return { status: 200, body: JS_SHELL, etag: null, lastModified: null }; };
  const chain = createFetchChain(
    [conditionalGetTier(t0), scraplingTier(async () => { scraplingCalls++; return GOOD_PAGE; })],
    store,
    { onTierChange: (e) => events.push(e) },
  );
  const f = chain("jefferson");
  const r1 = await f("https://x", { etag: null, lastModified: null });
  ok("escalated to scrapling and got real content", "body" in r1 && r1.body === GOOD_PAGE);
  ok("outcome names the tier that answered", f.lastOutcome()!.tierName === "scrapling");
  ok("failure reason recorded", /JS-rendered shell/.test(f.lastOutcome()!.attempts[0].error), JSON.stringify(f.lastOutcome()!.attempts));
  ok("tier change emitted for the digest", events.length === 1 && events[0].to === 1, JSON.stringify(events));
  ok("source promoted in the store", states.get("jefferson")!.tier === 1);

  // Second run must NOT waste a request on the tier that already failed.
  const before = t0Calls;
  await f("https://x", { etag: null, lastModified: null });
  ok("next run skips the known-broken tier", t0Calls === before, `t0 called ${t0Calls - before} more times`);
  ok("scrapling used again", scraplingCalls === 2, String(scraplingCalls));
}

console.log("\n=== Full chain: both lower tiers fail ===\n");
{
  const { store } = makeStore();
  const t0: Fetcher = async () => { throw new Error("HTTP 403"); };
  const chain = createFetchChain(
    [conditionalGetTier(t0),
     scraplingTier(async () => { throw new Error("cloudflare challenge"); }),
     scrapeGraphTier(async () => GOOD_PAGE)],
    store,
  );
  const f = chain("hard-source");
  const r = await f("https://x", { etag: null, lastModified: null });
  ok("reaches tier 2 and succeeds", "body" in r && r.body === GOOD_PAGE);
  const o = f.lastOutcome()!;
  ok("both failures recorded with reasons", o.attempts.length === 2 && /403/.test(o.attempts[0].error) && /cloudflare/.test(o.attempts[1].error), JSON.stringify(o.attempts));
  ok("provenance says which tier answered", o.tierName === "scrapegraph");
}

console.log("\n=== Budget guard on the paid tier ===\n");
{
  const { store, addSpend } = makeStore();
  addSpend(0.99);
  let graphCalls = 0;
  const chain = createFetchChain(
    [conditionalGetTier(async () => { throw new Error("HTTP 500"); }),
     scraplingTier(async () => { throw new Error("still blocked"); }),
     scrapeGraphTier(async () => { graphCalls++; return GOOD_PAGE; }, 0.05)],
    store,
    { budgetPerPeriod: 1.0 },
  );
  const f = chain("expensive");
  let threw = false;
  try { await f("https://x", { etag: null, lastModified: null }); } catch { threw = true; }
  ok("paid tier refused over budget", threw && graphCalls === 0);
  ok("budget reason stated, not a silent skip", /budget exhausted/.test(f.lastOutcome()!.attempts.at(-1)!.error), JSON.stringify(f.lastOutcome()!.attempts));
}

console.log("\n=== Cost decays: a recovered source demotes ===\n");
{
  const { store, states } = makeStore();
  const events: any[] = [];
  await store.set({ sourceId: "recovered", tier: 1, cleanRuns: 7 });
  const chain = createFetchChain(
    [conditionalGetTier(async () => ({ status: 200, body: GOOD_PAGE, etag: null, lastModified: null })),
     scraplingTier(async () => GOOD_PAGE)],
    store,
    { onTierChange: (e) => events.push(e) },
  );
  const f = chain("recovered");
  await f("https://x", { etag: null, lastModified: null });
  ok("demoted back to the free tier", states.get("recovered")!.tier === 0, JSON.stringify(states.get("recovered")));
  ok("demotion reported", events.some((e) => e.from === 1 && e.to === 0), JSON.stringify(events));
  ok("one bad week does not cost forever", states.get("recovered")!.cleanRuns === 0);
}

console.log("\n=== 304 still works through the chain ===\n");
{
  const { store, states } = makeStore();
  const chain = createFetchChain([conditionalGetTier(async () => ({ status: 304 as const }))], store);
  const f = chain("cached");
  const r = await f("https://x", { etag: 'W/"abc"', lastModified: null });
  ok("304 passes through untouched", r.status === 304);
  ok("counts as a clean run", states.get("cached")!.cleanRuns === 1);
}

console.log("\n=== The constraint: fetch is delegated, extraction is not ===\n");
{
  const tiers = [
    conditionalGetTier(async () => ({ status: 200, body: GOOD_PAGE, etag: null, lastModified: null })),
    scraplingTier(async () => GOOD_PAGE),
    scrapeGraphTier(async () => GOOD_PAGE),
  ];
  ok("every tier returns text, none returns fields",
     tiers.every((t) => typeof t.fetch === "function") && !tiers.some((t) => "extract" in t));

  // Whatever tier answered, the body must still bind as evidence.
  const { store } = makeStore();
  const chain = createFetchChain(tiers, store);
  const f = chain("any");
  const r = await f("https://x", { etag: null, lastModified: null });
  const body = "body" in r ? r.body! : "";
  const quote = "A minimum GPA of 3.0 is required";
  ok("a quote from tier output binds literally", body.includes(quote), body.slice(-80));
  ok("free tier preferred when it works", f.lastOutcome()!.tier === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
