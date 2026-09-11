import inventorySnapshot from "../../../data/alumni-employer-inventory.json";
import {
  buildEmployerInventoryDiscoveryPlans,
  getEmployerInventoryMetadata,
  selectEmployerDiscoveryCohort,
} from "../../lib/pipeline/employer-inventory";

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${detail}`}`);
};

const serialized = JSON.stringify(inventorySnapshot);
const metadata = getEmployerInventoryMetadata();
ok("snapshot is pinned to an upstream commit", /^[0-9a-f]{40}$/.test(metadata.sourceCommit));
ok("all upstream rows were reconciled", metadata.sourceRows === 196, String(metadata.sourceRows));
ok("duplicate locations collapse to unique employers", metadata.uniqueEmployers === 185, String(metadata.uniqueEmployers));
ok("snapshot contains no alumni profiles", !serialized.includes("linkedin.com/") && !serialized.includes('"alums"'));
ok("snapshot excludes coordinates and upstream IDs", !serialized.includes('"lat"') && !serialized.includes('"lng"') && !serialized.includes('"id"'));
ok(
  "company names are unique",
  new Set(inventorySnapshot.employers.map((employer) => employer.company.toLocaleLowerCase())).size === inventorySnapshot.employers.length,
);

const cohort = selectEmployerDiscoveryCohort({ limit: 5 });
ok("cohort is bounded", cohort.length === 5);
ok("cohort is ranked by local aggregate signal", cohort[0].localAlumniCount >= cohort[1].localAlumniCount);
ok("known local employer is represented", inventorySnapshot.employers.some((employer) => employer.company === "Kite Pharma"));

const regional = selectEmployerDiscoveryCohort({ limit: 10, regions: ["Orange County"] });
ok("region filter is exact and case-insensitive", regional.length > 0 && regional.every((employer) => employer.regions.includes("Orange County")));

const plans = buildEmployerInventoryDiscoveryPlans({ cycleYear: 2027, limit: 3 });
ok("each employer receives five bounded queries", plans.length === 3 && plans.every((candidate) => candidate.plan.queries.length === 5));
ok("official-site search uses the sanitized company website host", plans.every((candidate) => candidate.plan.careersDomain));

let rejectedOversize = false;
try {
  selectEmployerDiscoveryCohort({ limit: 51 });
} catch {
  rejectedOversize = true;
}
ok("cohorts cannot exceed the safety cap", rejectedOversize);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
