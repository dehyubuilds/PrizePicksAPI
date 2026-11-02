#!/usr/bin/env node
/**
 * VALORANT Maps 1–2 research. Read only. Does not place orders or share a page.
 *
 *   npm run prizepicks:valorant -- --mode full --max-matches 5 --max-grok-calls 6 --max-grok-spend 2
 */
import { loadEnvFile } from "./env-lib.mjs";
import { formatValorantSummary, parseValorantArgs, runValorant } from "../src/lib/prizepicks-valorant/run.ts";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run prizepicks:valorant -- [--mode sources|board|intelligence|history|model|backtest|report|full] [--estimate] [--dry-run] [--max-grok-spend 2] [--max-grok-calls 6] [--max-matches 5] [--verbose]");
  process.exit(0);
}

const options = parseValorantArgs(process.argv.slice(2));
const report = await runValorant(options);
console.log(formatValorantSummary(report));
if (options.verbose) {
  for (const row of report.projections) console.log(`${row.player} ${row.line} ${row.status} ${row.verdict}`);
}
