import { loadTaxonomy, classify, buildQueries } from "../../lib/pipeline/classify";

const tax = loadTaxonomy();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? `  -> ${detail}` : ""}`);
};

const P = (title: string, employer: string, body: string) => ({ title, employer, body });

console.log("=== Should KEEP: real graduate-relevant roles ===\n");

const jnj = P(
  "Technology 2027 Summer Internship",
  "Johnson & Johnson",
  `Johnson & Johnson is recruiting for the Technology Summer Internship Program. Interns support data science, AI, and digital health initiatives across our pharmaceutical and medical device segments.
   Qualifications: Applicants must be currently enrolled in a Bachelor's or Master's degree program in Computer Science, Data Science, Information Technology, or a related field.
   A minimum cumulative GPA of 3.0 is required. Candidates must have permanent US work authorization; the company does not provide sponsorship for this role.
   Experience with Python, SQL, and machine learning frameworks preferred. Hybrid: three days on-site and two remote days. Multiple U.S. locations.`,
);
const c1 = classify(jnj, tax);
ok("J&J kept", c1.keep, c1.dropReason);
ok("J&J lane = data science w/ bio context", c1.lanes.some((l) => l.id === "data_science"), JSON.stringify(c1.lanes.map(l => l.id)));
ok("J&J stage = msc_any", c1.stage.id === "msc_any", c1.stage.id);
ok("J&J bucket = graduate", c1.suggestedBucket === "graduate", c1.suggestedBucket);
ok("J&J surfaces personal gates", ["gpa", "work_authorization"].every((g) => c1.personalGates.includes(g)), c1.personalGates.join(","));
ok("J&J captures dry-lab methods", c1.methods.dry_lab.includes("python") && c1.methods.dry_lab.includes("sql"), c1.methods.dry_lab.join(","));

const nih = P(
  "Summer Internship Program in Biomedical Research",
  "National Institutes of Health",
  `The NIH Summer Internship Program provides research training. Graduate students are eligible.
   Candidates must be U.S. citizens or permanent residents and must be enrolled at least half-time.
   Projects span genomics, single-cell RNA-seq analysis, and computational biology using Python and R/Bioconductor.
   Opens mid-November 2026; closes mid-February 2027.`,
);
const c2 = classify(nih, tax);
ok("NIH kept", c2.keep, c2.dropReason);
ok("NIH lanes include genomics + single_cell", ["genomics", "single_cell"].every((l) => c2.lanes.some((x) => x.id === l)), c2.lanes.map(l=>l.id).join(","));
ok("NIH bucket = graduate despite citizenship gate", c2.suggestedBucket === "graduate", c2.suggestedBucket);
ok("NIH citizenship listed as PERSONAL gate", c2.personalGates.includes("citizenship") && c2.structuralGate === null);

const amgen = P(
  "Grad Intern - Operations Process Development",
  "Amgen",
  `Master's students accepted. Candidates must have completed at least one year of their graduate program before the start date and must continue enrollment after the internship.
   Focus on bioprocess development, upstream process characterization, and cGMP tech transfer. Rolling review.`,
);
const c3 = classify(amgen, tax);
ok("Amgen kept", c3.keep, c3.dropReason);
ok("Amgen stage = msc_year2 (year-one-completed rule)", c3.stage.id === "msc_year2", c3.stage.id);
ok("Amgen lane = bioprocess", c3.lanes[0]?.id === "bioprocess", c3.lanes.map(l=>l.id).join(","));
ok("Amgen return rule flagged", c3.personalGates.includes("return_rule"));

console.log("\n=== Should BUCKET, not drop ===\n");

const ibri = P(
  "Computational Research Intern (2027)",
  "Indiana Biosciences Research Institute",
  `Translational computation, omics, imaging and machine learning. Open to undergraduate or graduate students.
   Applicants must be an Indiana university student or recent graduate, or an Indiana high-school graduate.
   Priority deadline Oct 15; final Nov 30, 2026.`,
);
const c4 = classify(ibri, tax);
ok("IBRI kept (evidence retained)", c4.keep, c4.dropReason);
ok("IBRI bucket = special", c4.suggestedBucket === "special", c4.suggestedBucket);
ok("IBRI structural gate identified", c4.structuralGate?.id === "institution_affiliation", JSON.stringify(c4.structuralGate));

const sanofi = P(
  "2027 Spring Co-op - Bioinformatics",
  "Sanofi",
  `Six-month Spring co-op. Single-cell and spatial omics, neurodegeneration. Master's students accepted. 40 hours/week, Cambridge MA.`,
);
const c5 = classify(sanofi, tax);
ok("Sanofi kept", c5.keep, c5.dropReason);
ok("Sanofi bucket = adjacent (co-op beats 'internship')", c5.suggestedBucket === "adjacent", c5.suggestedBucket);
ok("Sanofi reason names the term", /co-?op/.test(c5.opportunityType?.reason ?? ""), c5.opportunityType?.reason);

const allen = P(
  "ASPIRE Post-Baccalaureate Internship - Summer 2027 cohort",
  "Allen Institute",
  `A year-long post-baccalaureate program for recent bachelor's graduates. Cell science, brain science, computational biology.`,
);
const c6 = classify(allen, tax);
ok("Allen bucket = adjacent", c6.suggestedBucket === "adjacent", c6.suggestedBucket);

const undergradOnly = P(
  "Summer Research Internship",
  "Example Institute",
  `Cancer biology and genomics research. Applicants must be currently enrolled in an undergraduate program; rising juniors and seniors preferred.`,
);
const c7 = classify(undergradOnly, tax);
ok("Undergrad-only -> excluded, not silently dropped", c7.suggestedBucket === "excluded" && c7.keep, `${c7.suggestedBucket}/${c7.keep}`);

console.log("\n=== Should DROP: the false positives that break naive scorers ===\n");

const bankML = P(
  "Data Science Intern",
  "Global Capital Partners",
  `Join our analytics team. Build machine learning models for credit risk and portfolio insights. Python, SQL, deep learning. Summer internship.`,
);
const c8 = classify(bankML, tax);
ok("Finance ML dropped (no biological context)", !c8.keep, `kept with lanes ${c8.lanes.map(l=>l.id).join(",")}`);

const salesRole = P(
  "Oncology Sales Representative Intern",
  "BigPharma Inc",
  `Support the oncology sales team with territory analytics and customer engagement in our cancer portfolio.`,
);
const c9 = classify(salesRole, tax);
ok("Oncology SALES dropped on title", !c9.keep, c9.dropReason);

const marketing = P(
  "Marketing Intern - Genomics Division",
  "SeqCo",
  `Support marketing campaigns for our genomics and sequencing product line.`,
);
const c10 = classify(marketing, tax);
ok("Genomics MARKETING dropped on title", !c10.keep, c10.dropReason);

const weakOnly = P(
  "Operations Intern",
  "Logistics Co",
  `Support daily operations and production scheduling. Track growth and survival of key accounts.`,
);
const c11 = classify(weakOnly, tax);
ok("Weak terms alone do not make a lane", !c11.keep, `${c11.dropReason ?? c11.lanes.map(l=>l.id).join(",")}`);

console.log("\n=== Edge cases in term matching ===\n");
const alsRole = P("Research Intern", "Neuro Institute", `Studying ALS and neurodegeneration; iPSC-derived neuron models. Graduate students welcome. Also includes imaging.`);
const c12 = classify(alsRole, tax);
ok("'ALS' matches, 'also' does not false-match", c12.lanes.some((l) => l.id === "neuro"), c12.lanes.map(l=>l.id).join(","));

const ioRole = P("Computational Biology Intern", "ImmunoCo", `Immuno-oncology target discovery, neoantigen prediction, T cell receptor sequencing. Master's students.`);
const c13 = classify(ioRole, tax);
ok("hyphenated 'immuno-oncology' matches cancer", c13.lanes.some((l) => l.id === "cancer"), c13.lanes.map(l=>l.id).join(","));
ok("multi-lane detection works", c13.lanes.length >= 2, `${c13.lanes.length} lanes`);

console.log("\n=== Query generation ===\n");
const queries = buildQueries(tax);
ok("one query set per lane", queries.length === tax.lanes.length, `${queries.length}`);
ok("queries are short", queries.every((q) => q.queries.every((s) => s.split(" ").length <= 5)));
console.log("  sample:", queries.find(q=>q.lane==="single_cell")?.queries.slice(0,3).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
