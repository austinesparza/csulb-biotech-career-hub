import { segment, buildOffsetMap, normalizeForOffsets, summarize, fieldPalette, type Span, type ReviewField } from "../../lib/pipeline/highlight";
import { bindExtraction, normalize } from "../../lib/pipeline/evidence";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };

console.log("=== Normalization must match lib/evidence.ts exactly ===\n");
{
  const samples = [
    "Applicants must be\n  currently enrolled.",
    "A  minimum\tcumulative GPA\u00a0of 3.0.",
    "Master\u2019s students \u2014 accepted.",
    "  leading and trailing  ",
  ];
  ok("identical output on every sample", samples.every((s) => normalizeForOffsets(s) === normalize(s)),
     samples.map((s) => `${JSON.stringify(normalizeForOffsets(s))} vs ${JSON.stringify(normalize(s))}`).join(" | "));
}

console.log("\n=== Offset map ===\n");
{
  const original = "one   two\n\nthree";
  const map = buildOffsetMap(original);
  const normalized = normalizeForOffsets(original);
  ok("map length equals normalized length", map.length === normalized.length, `${map.length} vs ${normalized.length}`);
  ok("every mapped index lands on the right character",
     [...normalized].every((ch, i) => ch === " " ? /\s/.test(original[map[i]]) : original[map[i]] === ch),
     [...normalized].map((ch, i) => `${ch}->${original[map[i]]}`).join(""));
}

console.log("\n=== Segmentation tiles the input exactly ===\n");
const SOURCE = `Summer 2027 Internship

Applicants must be currently enrolled in a Master's or PhD program.
A minimum cumulative GPA of 3.0 is required.
We do not provide visa sponsorship for internships.`;
{
  const n = normalizeForOffsets(SOURCE);
  const spanFor = (field: string, quote: string): Span => {
    const start = n.indexOf(normalizeForOffsets(quote));
    return { field, start, end: start + normalizeForOffsets(quote).length };
  };
  const spans = [
    spanFor("masters_eligibility", "currently enrolled in a Master's or PhD program"),
    spanFor("gpa_requirement", "minimum cumulative GPA of 3.0 is required"),
    spanFor("work_authorization", "do not provide visa sponsorship"),
  ];
  ok("all spans located", spans.every((s) => s.start >= 0), JSON.stringify(spans));

  const { segments, unplaced } = segment(SOURCE, spans);
  ok("nothing unplaced", unplaced.length === 0, unplaced.join(","));
  ok("segments reconstruct the source exactly", segments.map((s) => s.text).join("") === SOURCE);
  ok("line breaks preserved for display", segments.map((s) => s.text).join("").includes("\n\n"));

  const highlighted = segments.filter((s) => s.fields.length > 0);
  ok("three highlighted regions", highlighted.length === 3, String(highlighted.length));
  const gpa = highlighted.find((s) => s.fields.includes("gpa_requirement"))!;
  ok("GPA highlight covers the right words", gpa.text.includes("GPA of 3.0"), JSON.stringify(gpa.text));
  ok("highlight does not bleed into neighbouring text", !gpa.text.includes("sponsorship"), gpa.text);

  const masters = highlighted.find((s) => s.fields.includes("masters_eligibility"))!;
  ok("multi-line-adjacent span is exact", masters.text === "currently enrolled in a Master's or PhD program", JSON.stringify(masters.text));
}

console.log("\n=== Drift: the bug that only shows up late in a document ===\n");
{
  // Lots of collapsed whitespace before the target. A naive implementation is
  // off by exactly the number of collapsed characters, so the LAST highlight
  // is badly wrong while the first looks fine.
  const messy = "a".padEnd(1, "a") + "\n\n\n   " + "filler ".repeat(40) + "\n\n\n  THE TARGET PHRASE HERE  \n\n";
  const n = normalizeForOffsets(messy);
  const start = n.indexOf("THE TARGET PHRASE HERE");
  const { segments } = segment(messy, [{ field: "t", start, end: start + "THE TARGET PHRASE HERE".length }]);
  const hit = segments.find((s) => s.fields.includes("t"))!;
  ok("late-document highlight is still exact", hit.text === "THE TARGET PHRASE HERE", JSON.stringify(hit.text));
  ok("still reconstructs the original", segments.map((s) => s.text).join("") === messy);
}

console.log("\n=== Overlapping citations ===\n");
{
  const text = "Master's students with a 3.0 GPA are eligible.";
  const n = normalizeForOffsets(text);
  const a = { field: "eligibility", start: n.indexOf("Master's students"), end: n.indexOf("are eligible") + "are eligible".length };
  const b = { field: "gpa", start: n.indexOf("3.0 GPA"), end: n.indexOf("3.0 GPA") + "3.0 GPA".length };
  const { segments } = segment(text, [a, b]);
  ok("overlap reconstructs exactly (no duplication or loss)", segments.map((s) => s.text).join("") === text, segments.map((s) => s.text).join("|"));
  const shared = segments.filter((s) => s.shared);
  ok("overlap marked as shared", shared.length === 1 && shared[0].text.includes("3.0 GPA"), JSON.stringify(shared.map((s) => s.text)));
  ok("shared segment lists both fields", shared[0].fields.sort().join(",") === "eligibility,gpa", shared[0].fields.join(","));
}

console.log("\n=== Bad input degrades safely ===\n");
{
  const r1 = segment(SOURCE, [{ field: "bad", start: -5, end: 10 }]);
  ok("negative start reported as unplaced", r1.unplaced.includes("bad"));
  ok("text still fully rendered", r1.segments.map((s) => s.text).join("") === SOURCE);
  const r2 = segment(SOURCE, [{ field: "past-end", start: 5, end: 999999 }]);
  ok("out-of-range end reported, not thrown", r2.unplaced.includes("past-end"));
  const r3 = segment(SOURCE, [{ field: "inverted", start: 20, end: 10 }]);
  ok("inverted span reported", r3.unplaced.includes("inverted"));
  ok("no spans at all returns one plain segment", segment("hello", []).segments.length === 1);
  ok("empty source does not throw", segment("", []).segments[0].text === "");
}

console.log("\n=== End to end with real binding output ===\n");
{
  const bound = bindExtraction({
    masters_eligibility: { value: "Master's or PhD", quote: "currently enrolled in a Master's or PhD program" },
    gpa_requirement: { value: "3.0", quote: "minimum cumulative GPA of 3.0 is required" },
    deadline: { value: "Unknown", quote: null },
  } as never, SOURCE);
  ok("binding succeeded", bound.ok, bound.failures.join("; "));

  const spans: Span[] = Object.entries(bound.fields)
    .filter(([, b]) => b.start !== null)
    .map(([field, b]) => ({ field, start: b.start!, end: b.end! }));
  ok("only cited fields produce spans", spans.length === 2, String(spans.length));

  const { segments, unplaced } = segment(SOURCE, spans);
  ok("offsets from evidence.ts place correctly in the UI", unplaced.length === 0, unplaced.join(","));
  const texts = segments.filter((s) => s.fields.length).map((s) => s.text);
  ok("highlighted text matches the model's quotes",
     texts.includes("currently enrolled in a Master's or PhD program") && texts.includes("minimum cumulative GPA of 3.0 is required"),
     JSON.stringify(texts));
}

console.log("\n=== Review summary ===\n");
{
  const fields: ReviewField[] = [
    { name: "masters_eligibility", label: "Master's eligibility", value: "Master's accepted", quote: "q", bound: true },
    { name: "work_authorization", label: "Work authorization", value: "No sponsorship", quote: null, bound: false },
    { name: "pay_range", label: "Pay", value: "$32/hr", quote: null, bound: false },
    { name: "deadline", label: "Deadline", value: "Unknown", quote: null, bound: false },
    { name: "location", label: "Location", value: "Columbus", quote: "q", bound: true, edited: true },
  ];
  const s = summarize(fields);
  ok("counts cited", s.cited === 2, String(s.cited));
  ok("counts uncited assertions", s.uncited === 2, String(s.uncited));
  ok("Unknown is not counted as uncited", s.unknown === 1 && !s.needsAttention.includes("deadline"), JSON.stringify(s));
  ok("counts edits", s.edited === 1);
  ok("decision-bearing field surfaces first", s.needsAttention[0] === "work_authorization", s.needsAttention.join(","));

  const palette = fieldPalette(["b", "a", "c"]);
  ok("palette is stable and deterministic", JSON.stringify(palette) === JSON.stringify(fieldPalette(["c", "b", "a"])));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
