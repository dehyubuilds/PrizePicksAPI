#!/usr/bin/env node
/**
 * PrizePicks vs sportsbook consensus. Grok research is opt-in.
 *
 *   npm run prizepicks:odds -- --estimate
 *   npm run prizepicks:odds
 *   npm run prizepicks:odds -- --sports WNBA,NHL
 *   npm run prizepicks:odds -- --sports all
 */
import { loadEnvFile } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

function parseArgs(argv) {
  const opts = {
    count: 6,
    minEdge: 12,
    estimate: false,
    json: false,
    noPublish: false,
    sports: ["all"],
    mode: "disagreement",
    markets: "props",
    rank: "probability",
    countPerSport: 5,
    research: undefined,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--estimate") opts.estimate = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--no-publish") opts.noPublish = true;
    else if (arg === "--count" && argv[i + 1]) opts.count = Number(argv[++i]);
    else if (arg === "--min-edge" && argv[i + 1]) opts.minEdge = Number(argv[++i]);
    else if (arg === "--sports" && argv[i + 1]) {
      opts.sports = argv[++i].split(",").map((sport) => sport.trim()).filter(Boolean);
    } else if (arg === "--mode" && argv[i + 1]) opts.mode = argv[++i];
    else if (arg === "--markets" && argv[i + 1]) opts.markets = argv[++i];
    else if (arg === "--rank" && argv[i + 1]) opts.rank = argv[++i];
    else if (arg === "--count-per-sport" && argv[i + 1]) opts.countPerSport = Number(argv[++i]);
    else if (arg === "--max-credits" && argv[i + 1]) opts.maxCredits = Number(argv[++i]);
    else if (arg === "--research" && argv[i + 1]) opts.research = argv[++i];
    else if (arg === "--max-grok-candidates" && argv[i + 1]) opts.maxGrokCandidates = Number(argv[++i]);
    else if (arg === "--max-grok-spend" && argv[i + 1]) opts.maxGrokSpend = Number(argv[++i]);
    else if (arg === "--min-probability" && argv[i + 1]) opts.minProbability = Number(argv[++i]);
    else if (arg === "--min-books" && argv[i + 1]) opts.minBooks = Number(argv[++i]);
    else if (arg === "--max-quote-age" && argv[i + 1]) opts.maxQuoteAgeMinutes = Number(argv[++i]);
    else if (arg === "--max-disagreement" && argv[i + 1]) opts.maxDisagreement = Number(argv[++i]);
    else if (arg === "--max-picks" && argv[i + 1]) opts.maxPicks = Number(argv[++i]);
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run prizepicks:odds -- [options]

Compare PrizePicks props to US sportsbook lines (The Odds API).
Default scan is every supported sport. Keeps the 6 largest gaps. Same-number floor is +12%.

Options:
  --sports all         Leagues to scan (default all; example: WNBA,NHL)
  --markets moneyline  Game moneylines for one league (example: --sports CFB --markets moneyline)
  --estimate           Show the credit bill. Does not call the odds API.
  --count 6            Max legs (default 6)
  --min-edge 12        Minimum same-number edge in percentage points (default 12)
  --mode daily         disagreement (default), daily, entries, recheck, settle, or backtest
  --rank probability   probability, opportunity, confidence, ev, or entry
  --count-per-sport 5  Leaderboard size per sport
  --research auto      auto on daily/recheck when a key, a price, and a spend cap exist; or none, or grok
  --max-grok-candidates 10
  --max-grok-spend N   Dollars. Requires XAI_USD_PER_RESEARCH or research is skipped.
  --max-credits N      Optional credit stop. Unset means no per-run cap.
  --json               JSON output
  --no-publish         Skip the S3 page
  --help               Show help
`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

try {
  if (opts.markets !== "props" && opts.markets !== "moneyline") {
    throw new Error(`Unknown --markets ${opts.markets}. Use props or moneyline.`);
  }
  if (opts.markets === "moneyline") {
    const { runMoneylineScan } = await import("../src/lib/prizepicks-odds/moneyline.ts");
    await runMoneylineScan({ sports: opts.sports, noPublish: opts.noPublish });
  } else {
    const { runPrizePicksOddsCli } = await import("../src/lib/prizepicks-odds/run.ts");
    await runPrizePicksOddsCli(opts);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`prizepicks-odds: ${message}`);
  process.exit(1);
}
