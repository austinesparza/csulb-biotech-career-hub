import { execFileSync } from "node:child_process";
const suites = ["classify", "connectors", "worker", "eval", "publish", "recall", "integrity", "retrieval", "highlight", "fetch-chain", "safe-fetch", "operational-adapters", "source-runner", "search-plan", "employer-inventory"];
let failed = 0;
for (const suite of suites) {
  try {
    const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", `src/__tests__/pipeline/${suite}.test.ts`], { encoding: "utf8" });
    console.log(`${suite.padEnd(12)} ${out.trim().split("\n").at(-1)}`);
  } catch (error: any) {
    failed++;
    console.log(`${suite.padEnd(12)} FAILED`);
    console.log((error.stdout ?? "").split("\n").filter((line: string) => line.startsWith("FAIL")).join("\n"));
  }
}
process.exit(failed ? 1 : 0);
