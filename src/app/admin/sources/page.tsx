import Link from "next/link";

import { createServiceClient, requireOfficer } from "@/lib/supabase/server";
import { createJobSource, runSourceNow, testSourceNow, toggleSourcePause, updateSourceGovernance } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default async function SourcesPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data, error } = await db.from("job_sources")
    .select("id, source_name, source_kind, source_identifier, careers_url, enabled, fetch_interval_hours, terms_reviewed, terms_review_date, robots_reviewed, automatic_scheduling_paused_at, last_attempted_at, last_successful_at, consecutive_failures")
    .order("priority")
    .order("source_name");
  if (error) throw new Error(`Could not load sources: ${error.message}`);
  const sources = data ?? [];

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
      <h2 className="font-semibold">Add a source</h2>
      <form action={createJobSource} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Source name
          <input className="mt-1 w-full rounded-md border p-2" name="source_name" required placeholder="Company careers board" />
        </label>
        <label className="text-sm">Type
          <select className="mt-1 w-full rounded-md border p-2" name="source_kind" defaultValue="greenhouse">
            <option value="greenhouse">Greenhouse feed</option>
            <option value="static_html">Public careers page</option>
            <option value="schema_org">Schema.org jobs page</option>
          </select>
        </label>
        <label className="text-sm md:col-span-2">Public careers URL
          <input className="mt-1 w-full rounded-md border p-2" name="careers_url" type="url" required placeholder="https://boards.greenhouse.io/company" />
        </label>
        <label className="text-sm">Board token
          <input className="mt-1 w-full rounded-md border p-2" name="source_identifier" placeholder="Required for Greenhouse only" />
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
          <label><input className="mr-2" type="checkbox" name="enabled" />Enable after saving</label>
        </div>
        <p className="text-xs md:col-span-2" style={{ color: "var(--ink-soft)" }}>
          LinkedIn belongs in the lead archive, not here. Do not add login-gated pages, session URLs, or sources whose automation rules are unclear.
        </p>
        <div className="md:col-span-2">
          <button className="primary-button" type="submit">Save source</button>
        </div>
      </form>
    </section>

    <section className="space-y-4">
      <h2 className="font-semibold">Configured sources ({sources.length})</h2>
      {sources.length === 0 ? <div className="rounded-xl bg-white p-5 text-sm" style={{ border: "1px solid var(--line)" }}>
        No machine sources are configured yet. Add one reviewed employer source above, then run one manual capture before relying on the daily loop.
      </div> : sources.map((source) => {
        const paused = Boolean(source.automatic_scheduling_paused_at);
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
        </article>;
      })}
    </section>
  </div>;
}
