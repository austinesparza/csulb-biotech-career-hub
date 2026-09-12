import Link from "next/link";

import { GOVERNED_STARTER_SOURCES, GREENHOUSE_POLICY_LINKS } from "@/lib/ingestion/starter-sources";
import { createServiceClient, requireOfficer } from "@/lib/supabase/server";
import { createJobSource, createStarterSource, runEmployerDiscoveryNow, runSourceNow, testSourceNow, toggleSourcePause, updateSourceGovernance } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default async function SourcesPage() {
  await requireOfficer();
  const db = createServiceClient();
  const [sourceResult, testRunResult] = await Promise.all([
    db.from("job_sources")
      .select("id, source_name, source_kind, source_identifier, careers_url, enabled, fetch_interval_hours, terms_reviewed, terms_review_date, robots_reviewed, automatic_scheduling_paused_at, last_attempted_at, last_successful_at, consecutive_failures")
      .order("priority")
      .order("source_name"),
    db.from("source_fetch_runs")
      .select("id, job_source_id, status, records_seen, records_reviewed, finished_at, log_json")
      .contains("log_json", { privateTest: true })
      .order("started_at", { ascending: false })
      .limit(100),
  ]);
  if (sourceResult.error) throw new Error(`Could not load sources: ${sourceResult.error.message}`);
  if (testRunResult.error) throw new Error(`Could not load private test history: ${testRunResult.error.message}`);
  const sources = sourceResult.data ?? [];
  const latestPrivateTestBySource = new Map<string, NonNullable<typeof testRunResult.data>[number]>();
  for (const run of testRunResult.data ?? []) {
    if (!latestPrivateTestBySource.has(run.job_source_id)) latestPrivateTestBySource.set(run.job_source_id, run);
  }
  const configuredGreenhouseTokens = new Set(
    sources
      .filter((source) => source.source_kind === "greenhouse")
      .map((source) => source.source_identifier),
  );
  const searchConfigured = process.env.DISCOVERY_SEARCH_ENABLED === "true"
    && Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim())
    && process.env.BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED === "true";

  return <div className="space-y-8">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automated sources</h1>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--ink-soft)" }}>
            Add only public employer-controlled feeds or pages. New sources stay disabled until an officer records terms and robots review.
          </p>
        </div>
        <Link className="secondary-button" href="/admin/integrations">Integration status</Link>
      </div>
    </div>

    <section className="rounded-xl bg-white p-5" style={{ border: "1px solid var(--line)" }}>
      <h2 className="font-semibold">Verified starter feeds</h2>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--ink-soft)" }}>
        Add a current official feed as a disabled source. Then review the linked policy evidence, save both review checks, run one private test, and enable it only after the results look right.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {GOVERNED_STARTER_SOURCES.map((starter) => {
          const configured = configuredGreenhouseTokens.has(starter.boardToken);
          return <article key={starter.id} className="rounded-lg p-4" style={{ border: "1px solid var(--line)" }}>
            <h3 className="font-semibold">{starter.sourceName}</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>{starter.rationale}</p>
            <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>Feed verified {starter.verifiedAt}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <a className="underline" href={starter.careersUrl} target="_blank" rel="noreferrer">Open board</a>
              <a className="underline" href={GREENHOUSE_POLICY_LINKS.apiDocumentation} target="_blank" rel="noreferrer">API policy</a>
              <a className="underline" href={GREENHOUSE_POLICY_LINKS.apiRobots} target="_blank" rel="noreferrer">API robots</a>
              <a className="underline" href={GREENHOUSE_POLICY_LINKS.boardRobots} target="_blank" rel="noreferrer">Board robots</a>
            </div>
            <form action={createStarterSource} className="mt-4">
              <input type="hidden" name="starter_id" value={starter.id} />
              <button className="secondary-button" type="submit" disabled={configured}>
                {configured ? "Already configured" : "Add disabled source"}
              </button>
            </form>
          </article>;
        })}
      </div>
      <p className="mt-3 text-xs" style={{ color: "var(--ink-soft)" }}>
        Greenhouse documents that Job Board GET data is public and does not require authentication. No application submission endpoint, login, or credential is used.
      </p>
    </section>

    <section className="rounded-xl bg-white p-5" style={{ border: "1px solid var(--line)" }}>
      <h2 className="font-semibold">Employer and LinkedIn lead discovery</h2>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--ink-soft)" }}>
        Search one rotating employer cohort on command. Results enter the private lead archive and officer task queue. LinkedIn results remain leads and cannot establish publication facts.
      </p>
      <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
        The search provider stays disabled until its API key and contractual result-storage right are both recorded in production.
      </p>
      <form action={runEmployerDiscoveryNow} className="mt-4">
        <button className="secondary-button" type="submit" disabled={!searchConfigured}>
          {searchConfigured ? "Run employer discovery now" : "Search provider not configured"}
        </button>
      </form>
    </section>

    <section className="rounded-xl bg-white p-5" style={{ border: "1px solid var(--line)" }}>
      <h2 className="font-semibold">Add a source</h2>
      <form action={createJobSource} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Source name
          <input className="mt-1 w-full rounded-md border p-2" name="source_name" required placeholder="Company careers board" />
        </label>
        <label className="text-sm">Type
          <select className="mt-1 w-full rounded-md border p-2" name="source_kind" defaultValue="greenhouse">
            <option value="greenhouse">Greenhouse feed</option>
            <option value="ashby">Ashby feed</option>
            <option value="lever">Lever feed</option>
            <option value="usajobs">USAJOBS search</option>
            <option value="static_html">Public careers page</option>
            <option value="schema_org">Schema.org jobs page</option>
          </select>
        </label>
        <label className="text-sm md:col-span-2">Public careers URL
          <input className="mt-1 w-full rounded-md border p-2" name="careers_url" type="url" required placeholder="https://boards.greenhouse.io/company" />
        </label>
        <label className="text-sm">Board token or query configuration
          <input className="mt-1 w-full rounded-md border p-2" name="source_identifier" placeholder="ATS token, or USAJOBS JSON query" />
        </label>
        <label className="text-sm">Check every
          <select className="mt-1 w-full rounded-md border p-2" name="fetch_interval_hours" defaultValue="24">
            <option value="24">Daily</option>
            <option value="72">Every 3 days</option>
            <option value="168">Weekly</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-5 text-sm md:col-span-2">
          <label><input className="mr-2" type="checkbox" name="terms_reviewed" />Terms reviewed</label>
          <label><input className="mr-2" type="checkbox" name="robots_reviewed" />Robots reviewed</label>
        </div>
        <p className="text-xs md:col-span-2" style={{ color: "var(--ink-soft)" }}>
          LinkedIn belongs in the lead archive, not here. Do not add login-gated pages, session URLs, or sources whose automation rules are unclear.
        </p>
        <div className="md:col-span-2">
          <button className="primary-button" type="submit">Save disabled source</button>
        </div>
      </form>
    </section>

    <section className="space-y-4">
      <h2 className="font-semibold">Configured sources ({sources.length})</h2>
      {sources.length === 0 ? <div className="rounded-xl bg-white p-5 text-sm" style={{ border: "1px solid var(--line)" }}>
        No machine sources are configured yet. Add one disabled employer source above, record its policy review, and run a private test before enabling the daily loop.
      </div> : sources.map((source) => {
        const paused = Boolean(source.automatic_scheduling_paused_at);
        const latestPrivateTest = latestPrivateTestBySource.get(source.id);
        return <article key={source.id} className="rounded-xl bg-white p-5" style={{ border: "1px solid var(--line)" }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold">{source.source_name}</h3>
              <a className="text-sm underline" href={source.careers_url} target="_blank" rel="noreferrer">Open source</a>
              <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
                {source.source_kind} · every {source.fetch_interval_hours}h · last success {when(source.last_successful_at)} · failures {source.consecutive_failures}
              </p>
            </div>
            <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: source.enabled && !paused ? "#16653412" : "#92400e12", color: source.enabled && !paused ? "#166534" : "#92400e" }}>
              {paused ? "Paused" : source.enabled ? "Active" : "Disabled"}
            </span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto_auto_auto]">
            <form action={updateSourceGovernance} className="flex flex-wrap items-center gap-4 text-sm">
              <input type="hidden" name="id" value={source.id} />
              <label><input className="mr-2" type="checkbox" name="terms_reviewed" defaultChecked={source.terms_reviewed} />Terms reviewed</label>
              <label><input className="mr-2" type="checkbox" name="robots_reviewed" defaultChecked={source.robots_reviewed} />Robots reviewed</label>
              <label><input className="mr-2" type="checkbox" name="enabled" defaultChecked={source.enabled} />Enabled</label>
              <button className="secondary-button" type="submit">Save controls</button>
            </form>
            <form action={toggleSourcePause}>
              <input type="hidden" name="id" value={source.id} />
              <input type="hidden" name="paused" value={paused ? "off" : "on"} />
              <button className="secondary-button" type="submit">{paused ? "Resume" : "Pause"}</button>
            </form>
            <form action={runSourceNow}>
              <input type="hidden" name="id" value={source.id} />
              <button className="primary-button" type="submit" disabled={!source.enabled || paused}>Run and archive now</button>
            </form>
            <form action={testSourceNow}>
              <input type="hidden" name="id" value={source.id} />
              <button className="secondary-button" type="submit" disabled={!source.terms_reviewed || !source.terms_review_date || !source.robots_reviewed}>
                Test privately
              </button>
            </form>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--ink-soft)" }}>
            Private tests work while a source is disabled or paused. They archive evidence and create review work, but do not enable scheduling, change source health, or publish anything.
          </p>
          {latestPrivateTest ? <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: "var(--paper-2)", border: "1px solid var(--line)" }}>
            <strong>Latest private test:</strong> {latestPrivateTest.status} at {when(latestPrivateTest.finished_at)}. {latestPrivateTest.records_seen} records observed; {latestPrivateTest.records_reviewed} new review tasks created.{' '}
            <Link className="underline" href="/admin/review">Open review queue</Link>
          </div> : null}
        </article>;
      })}
    </section>
  </div>;
}
