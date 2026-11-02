#!/usr/bin/env node
/**
 * PrizePicks category evaluation. Read only. Does not place orders or share a page.
 *
 *   npm run prizepicks:audit
 *   npm run prizepicks:audit -- --mode inventory
 *   npm run prizepicks:audit -- --mode sources --max-grok-spend 2
 *   npm run prizepicks:audit -- --mode markets --max-odds-credits 40
 *   npm run prizepicks:audit -- --mode full --max-odds-credits 40 --max-grok-spend 2
 *   npm run prizepicks:audit -- --mode report
 */
import { loadEnvFile } from "./env-lib.mjs";
import { formatAuditSummary, parseAuditArgs, runPrizePicksAudit } from "../src/lib/prizepicks-audit/run.ts";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run prizepicks:audit -- [--mode inventory|sources|markets|full|report] [--estimate] [--dry-run] [--max-odds-credits 40] [--max-grok-spend 2] [--max-categories 20] [--category NAME] [--verbose]");
  process.exit(0);
}

const options = parseAuditArgs(process.argv.slice(2));
const report = await runPrizePicksAudit(options);
console.log(formatAuditSummary(report));
