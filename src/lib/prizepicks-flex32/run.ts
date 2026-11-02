import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import {
  FLEX32_DEFAULT_HORIZON_HOURS,
  FLEX32_SPORTS,
  LEAGUE_ID_TO_SPORT,
  normalizeOddsBucket,
} from "./config";
import { formatFlex32Report } from "./format";
import { buildFlex32Candidates } from "./score";
import { selectFlex32Lineup } from "./select";
import type { Flex32Report, Flex32RunOptions } from "./types";

export function parseFlex32Args(argv: string[]): Flex32RunOptions & { help?: boolean } {
  const opts: Flex32RunOptions & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--cache") opts.preferCache = true;
    else if (a === "--live") opts.forceLive = true;
    else if (a === "--no-demon") opts.allowDemon = false;
    else if (a === "--horizon" && argv[i + 1]) {
      opts.horizonHours = Number(argv[++i]);
    } else if (a === "--sports" && argv[i + 1]) {
      opts.sports = argv[++i]!.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
  }
  return opts;
}

export async function runFlex32(options: Flex32RunOptions = {}): Promise<Flex32Report> {
  const sports = (options.sports?.length ? options.sports : [...FLEX32_SPORTS]).map((s) =>
    s.toUpperCase()
  );
  const horizonHours =
    options.horizonHours != null && Number.isFinite(options.horizonHours)
      ? options.horizonHours
      : FLEX32_DEFAULT_HORIZON_HOURS;
  const nowMs = options.nowMs ?? Date.now();

  const bundle = await fetchPrizePicksProjections({
    forceLive: options.forceLive === true || options.preferCache !== true,
    preferCache: options.preferCache === true,
    disallowCacheFallback: false,
  });

  const sportFiltered = bundle.projections.filter((p) => {
    const sport = LEAGUE_ID_TO_SPORT[String(p.leagueId)] || String(p.leagueName || "").toUpperCase();
    return sports.includes(sport);
  });

  const candidates = buildFlex32Candidates(sportFiltered, {
    nowMs,
    horizonHours,
    sports,
    allowDemon: options.allowDemon,
  });

  const selection = selectFlex32Lineup(candidates);

  const presentSports = new Set(candidates.map((c) => c.sport));
  const skippedSports = sports.filter((s) => !presentSports.has(s));

  const boardCounts = {
    total: sportFiltered.length,
    eligible: candidates.length,
    goblin: candidates.filter((c) => c.bucket === "goblin").length,
    standard: candidates.filter((c) => c.bucket === "standard").length,
    demon: candidates.filter((c) => c.bucket === "demon").length,
  };

  const warnings = [...selection.warnings];
  if (bundle.fromCache) {
    warnings.push("Used PrizePicks cache fallback — re-run with a fresh cookie if lines look stale.");
  }
  if (selection.picks.length < 5) {
    warnings.push(`Only ${selection.picks.length}/5 legs filled. Board may be thin for these sports.`);
  }

  // Sanity: mix counts
  const g = selection.picks.filter((p) => p.bucket === "goblin").length;
  const s = selection.picks.filter((p) => p.bucket === "standard").length;
  const d = selection.picks.filter((p) => p.bucket === "demon").length;
  if (selection.picks.length === 5 && !(g === 3 && ((s === 2 && d === 0) || (s === 1 && d === 1)))) {
    warnings.push(`Mix counts g=${g} s=${s} d=${d} — check board depth.`);
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    fetchedAt: bundle.fetchedAt,
    fromCache: Boolean(bundle.fromCache),
    mix: selection.mix,
    picks: selection.picks,
    alternates: selection.alternates,
    skippedSports,
    warnings,
    boardCounts,
  };
}

export { formatFlex32Report, normalizeOddsBucket };
