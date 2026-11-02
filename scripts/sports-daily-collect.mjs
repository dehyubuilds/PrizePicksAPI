#!/usr/bin/env node
/**
 * Collect a point-in-time sports evidence bundle locally and optionally upload it
 * to the private S3 intake prefix that starts the AoTQ draft workflow.
 *
 *   npm run sports-daily:collect -- --estimate
 *   npm run sports-daily:collect -- --dry-run
 *   npm run sports-daily:collect -- --upload
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, root } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

function parseArgs(argv) {
  const options = {
    estimate: false,
    dryRun: false,
    upload: false,
    sports: ["NBA"],
    maxCredits: 20,
    maxCandidates: 3,
    withOdds: true,
    withKalshi: true,
    withX: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--estimate") options.estimate = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--upload") options.upload = true;
    else if (arg === "--no-odds") options.withOdds = false;
    else if (arg === "--no-kalshi") options.withKalshi = false;
    else if (arg === "--with-x") options.withX = true;
    else if (arg === "--sports" && argv[index + 1]) {
      options.sports = argv[++index].split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    } else if (arg === "--max-credits" && argv[index + 1]) {
      options.maxCredits = Math.max(0, Number(argv[++index]) || 0);
    } else if (arg === "--max-candidates" && argv[index + 1]) {
      options.maxCandidates = Math.min(6, Math.max(1, Number(argv[++index]) || 3));
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run sports-daily:collect -- [options]

  --estimate            Estimate sportsbook usage; no evidence upload
  --dry-run             Retrieve and validate, but do not upload
  --upload              Upload immutable bundle to the AoTQ S3 intake prefix
  --sports NBA          Comma-separated leagues (default NBA)
  --max-credits 20      Hard Odds API credit cap (default 20)
  --max-candidates 3    Candidate cap, 1-6 (default 3)
  --no-odds             Skip sportsbook retrieval
  --no-kalshi           Skip Kalshi context
  --with-x              Allow bounded xAI/X research inside the existing odds run
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.dryRun && options.upload) throw new Error("--dry-run and --upload cannot be combined");
  return options;
}

function safeTimestamp(value, fallback, cutoff) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed > Date.parse(cutoff)) return fallback;
  return new Date(parsed).toISOString();
}

function normalizeStat(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("point")) return "points";
  if (text.includes("rebound")) return "rebounds";
  if (text.includes("assist")) return "assists";
  return text.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function kalshiForBundle(markets, observedAt) {
  return markets.slice(0, 3).map((market) => ({
    ticker: market.ticker,
    eventTicker: market.eventTicker || undefined,
    title: market.title,
    yesBid: numberOrUndefined(market.yesBidDollars),
    yesAsk: numberOrUndefined(market.yesAskDollars),
    volume: numberOrUndefined(market.volumeFp),
    observedAt,
    relationship: "contextual",
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.estimate) {
    if (!options.withOdds) {
      console.log("Estimate: sportsbook retrieval is disabled; no paid API requests would run.");
      return;
    }
    const { runPrizePicksOddsCli } = await import("../src/lib/prizepicks-odds/run.ts");
    await runPrizePicksOddsCli({
      estimate: true,
      noPublish: true,
      sports: options.sports,
      maxCredits: options.maxCredits,
      research: "none",
    });
    return;
  }

  const {
    canonicalEvidenceJson,
    evidenceBundleKey,
    evidenceSha256,
    newEvidenceBundleId,
    validateSportsDailyEvidenceBundle,
  } = await import("../src/lib/sports-daily/evidence-bundle.ts");
  const { fetchPrizePicksProjections } = await import("../src/lib/prizepicks/index.ts");
  const { persistPrizePicksBoardSnapshot } = await import("../src/lib/quant-research/prizepicks-snapshot.ts");
  const { writeImmutableQuantJson } = await import("../src/lib/quant-research/store.ts");
  const { config } = await import("../src/lib/config.ts");

  console.log("Sports Daily evidence collection");
  console.log(`  leagues:      ${options.sports.join(", ")}`);
  console.log(`  odds cap:     ${options.withOdds ? options.maxCredits : "disabled"}`);
  console.log(`  Kalshi:       ${options.withKalshi ? "enabled" : "disabled"}`);
  console.log(`  X context:    ${options.withX ? "bounded opt-in" : "disabled"}`);
  console.log(`  destination:  ${options.upload ? "private S3 intake" : "local only"}`);

  const board = await fetchPrizePicksProjections({ forceLive: true, disallowCacheFallback: true });
  const persisted = await persistPrizePicksBoardSnapshot(board, {
    localOnly: !options.upload,
    writeLatestPointer: options.upload,
    rootDir: root,
  });

  let oddsSnapshot = null;
  if (options.withOdds) {
    const { runPrizePicksOddsCli } = await import("../src/lib/prizepicks-odds/run.ts");
    const { readLatestSnapshot } = await import("../src/lib/prizepicks-odds/snapshots.ts");
    await runPrizePicksOddsCli({
      mode: "daily",
      noPublish: true,
      sports: options.sports,
      maxCredits: options.maxCredits,
      maxPicks: options.maxCandidates,
      research: options.withX ? "auto" : "none",
    });
    oddsSnapshot = readLatestSnapshot();
  }

  let kalshiMarkets = [];
  if (options.withKalshi) {
    const { fetchKalshiMarketsForSports } = await import("../src/lib/kalshi/index.ts");
    kalshiMarkets = await fetchKalshiMarketsForSports(options.sports);
  }

  const cutoff = new Date().toISOString();
  const boardJson = JSON.stringify(persisted.snapshot);
  const sourceObjects = [
    {
      provider: "prizepicks",
      observedAt: safeTimestamp(persisted.snapshot.observedAt, cutoff, cutoff),
      objectKey: persisted.s3Key || undefined,
      sha256: evidenceSha256(boardJson),
    },
  ];
  if (oddsSnapshot?.generatedAt) {
    sourceObjects.push({
      provider: "the_odds_api",
      observedAt: safeTimestamp(oddsSnapshot.generatedAt, cutoff, cutoff),
      sha256: evidenceSha256(JSON.stringify(oddsSnapshot)),
    });
  }
  if (kalshiMarkets.length) {
    sourceObjects.push({
      provider: "kalshi",
      observedAt: cutoff,
      sha256: evidenceSha256(JSON.stringify(kalshiMarkets)),
    });
  }

  const wanted = new Set(options.sports);
  const eligible = board.projections.filter((projection) => {
    const stat = normalizeStat(projection.statDisplayName || projection.statType);
    return wanted.has(projection.leagueName.trim().toUpperCase()) &&
      ["points", "rebounds", "assists"].includes(stat) &&
      Number.isFinite(projection.lineScore) &&
      Date.parse(projection.startTime) > Date.parse(cutoff);
  });
  const projectionById = new Map(eligible.map((projection) => [projection.id, projection]));
  const oddsLegs = oddsSnapshot?.legs ?? [];
  const ranked = [
    ...oddsLegs.map((leg) => projectionById.get(leg.id)).filter(Boolean),
    ...eligible,
  ];
  const unique = [...new Map(ranked.map((projection) => [projection.id, projection])).values()]
    .slice(0, options.maxCandidates);
  if (!unique.length) throw new Error("No eligible future NBA points, rebounds, or assists projections were found");

  const kalshiContext = kalshiForBundle(kalshiMarkets, cutoff);
  const candidates = unique.map((projection) => {
    const leg = oddsLegs.find((row) => row.id === projection.id);
    const probability = leg?.marketProbability;
    const lineObserved = safeTimestamp(projection.updatedAt || persisted.snapshot.observedAt, cutoff, cutoff);
    return {
      candidateId: `candidate_${projection.id}`,
      player: {
        canonicalId: `unresolved:player:${projection.playerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        displayName: projection.playerName,
        teamId: projection.team || undefined,
        externalIds: { prizepicksProjectionId: projection.id },
      },
      event: {
        canonicalId: `prizepicks:event:${projection.gameId}`,
        startAt: projection.startTime,
        opponentTeamId: projection.opponent || undefined,
        externalIds: { prizepicks: projection.gameId, ...(leg?.eventId ? { the_odds_api: leg.eventId } : {}) },
      },
      stat: {
        canonicalKey: normalizeStat(projection.statDisplayName || projection.statType),
        displayName: projection.statDisplayName || projection.statType,
      },
      postedLine: {
        value: projection.lineScore,
        projectionId: projection.id,
        observedAt: lineObserved,
        onAirLabel: "the posted line",
      },
      ...(leg
        ? {
            sportsbook: {
              marketKey: leg.market || normalizeStat(projection.statDisplayName || projection.statType),
              line: leg.line,
              ...(probability != null && leg.side === "over"
                ? { overProbability: probability, underProbability: 1 - probability }
                : probability != null
                  ? { underProbability: probability, overProbability: 1 - probability }
                  : {}),
              bookmakerCount: leg.books || 0,
              lastUpdateAt: safeTimestamp(leg.quotedAt || leg.sourceTimestamp, cutoff, cutoff),
            },
          }
        : {}),
      ...(kalshiContext.length ? { kalshi: kalshiContext } : {}),
      contextualClaimIds: [],
      limitations: [
        "Canonical player identity is unresolved because this projection response does not expose a durable player ID.",
        ...(leg ? [] : ["No comparable sportsbook quote was available within the configured credit cap."]),
        "Player image requires rights/provenance approval in AoTQ Studio.",
      ],
    };
  });

  const bundle = {
    schemaVersion: 1,
    bundleId: newEvidenceBundleId(new Date(cutoff)),
    createdAt: cutoff,
    observedAt: persisted.snapshot.observedAt,
    predictionCutoffAt: cutoff,
    league: options.sports.join(","),
    slateDate: cutoff.slice(0, 10),
    sourceObjects,
    claims: [],
    candidates,
    limitations: [
      "This bundle is research evidence, not a wagering recommendation.",
      "Social claims are absent unless they can be normalized with original IDs and point-in-time timestamps.",
      "Kalshi markets are contextual unless explicitly mapped to an identical event definition.",
      "Historical player features are omitted when a point-in-time cache is unavailable.",
    ],
  };
  const validated = validateSportsDailyEvidenceBundle(bundle);
  if (!validated.ok) throw new Error(`Evidence validation failed:\n- ${validated.errors.join("\n- ")}`);

  const body = canonicalEvidenceJson(validated.bundle);
  const digest = evidenceSha256(body);
  const localDir = path.join(root, "artifacts", "sports-daily", "evidence-bundles", cutoff.slice(0, 10));
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, `${bundle.bundleId}.json`);
  fs.writeFileSync(localPath, body, { flag: "wx" });
  const key = evidenceBundleKey(bundle);

  if (options.upload) {
    await writeImmutableQuantJson(key, validated.bundle, {
      kmsKeyId: process.env.AOTQ_SPORTS_DAILY_KMS_KEY_ID?.trim() || undefined,
    });
  }

  console.log(`OK  ${candidates.length} candidates`);
  console.log(`    bundleId  ${bundle.bundleId}`);
  console.log(`    sha256    ${digest}`);
  console.log(`    local     ${path.relative(root, localPath)}`);
  console.log(`    s3        ${options.upload ? `s3://${config.dropflow.bucket}/${key}` : "(skipped; pass --upload)"}`);
}

main().catch((error) => {
  console.error(`sports-daily: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
