#!/usr/bin/env node
/**
 * Flex 3-2 lineup from the live PrizePicks board.
 *
 * Preferred mix: 3 goblin + 2 standard
 * Fallback mix:  3 goblin + 1 standard + 1 mild demon
 *
 *   npm run prizepicks:flex32
 *   npm run prizepicks:flex32 -- --live
 *   npm run prizepicks:flex32 -- --cache
 *   npm run prizepicks:flex32 -- --sports NBA,MLB,WNBA
 *   npm run prizepicks:flex32 -- --no-demon
 *   npm run prizepicks:flex32 -- --horizon 36
 */
import { loadEnvFile } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

const { formatFlex32Report, parseFlex32Args, runFlex32 } = await import(
  "../src/lib/prizepicks-flex32/run.ts"
);

const opts = parseFlex32Args(process.argv.slice(2));
if (opts.help) {
  console.log(`Usage: npm run prizepicks:flex32 -- [options]

Options:
  --live          Force live PrizePicks pull (default)
  --cache         Prefer S3/local cache
  --sports A,B    Subset of MLB,WNBA,NBA,NFL
  --horizon N     Hours ahead to include (default 48)
  --no-demon      Never use the 3g+1s+1d fallback demon leg
  --help          Show this help

Strategy: highest-softness More legs on the live board.
Softness = how far a goblin sits under its player/stat main, or how soft a
standard is vs peer mains. Demons only if within +2 of the main.
`);
  process.exit(0);
}

try {
  const report = await runFlex32(opts);
  console.log(formatFlex32Report(report));
  if (report.picks.length < 5) process.exitCode = 2;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`prizepicks-flex32: ${message}`);
  process.exit(1);
}
