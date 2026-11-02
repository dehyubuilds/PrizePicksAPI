import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import type { PolymarketMarketSummary } from "@/lib/polymarket/types";
import { projectionSportTags } from "./infer-sport";
import {
  comboStatAllowedInMarket,
  confidenceFromMatchQuality,
  inferSideForPick,
  isComboStatProjection,
  normalizeMatchText,
  passesBinaryScorerGate,
  passesHardLineGate,
  thresholdMatchScore,
} from "./match-quality";
import type { EdgePickSide, EdgePolymarketMatch } from "./types";
import {
  adjustedProbability,
  edgePercent,
  polymarketSideImpliedProbability,
  prizepicksImpliedProbability,
} from "./implied-probability";

const STAT_KEYWORDS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "points", patterns: [/\bpoints?\b/i] },
  { key: "rebounds", patterns: [/\brebounds?\b/i, /\brebs?\b/i] },
  { key: "assists", patterns: [/\bassists?\b/i, /\basts?\b/i] },
  { key: "threes", patterns: [/\b3.?pt/i, /\bthrees?\b/i, /\b3pm\b/i] },
  { key: "rush", patterns: [/\brush(?:ing)?\s+yards?\b/i, /\brush\b/i] },
  { key: "rec", patterns: [/\breceiv(?:ing)?\s+yards?\b/i, /\breceptions?\b/i] },
  { key: "strikeouts", patterns: [/\bstrikeouts?\b/i, /\bk'?s\b/i] },
  { key: "hits", patterns: [/\bhits?\b/i] },
  { key: "goals", patterns: [/\bgoals?\b/i] },
];

const SPORT_ALIASES: Record<string, string[]> = {
  NBA: ["nba"],
  WNBA: ["wnba"],
  MLB: ["mlb", "baseball"],
  NHL: ["nhl", "hockey"],
  NFL: ["nfl"],
  MLS: ["mls"],
};

function statKeyForProjection(projection: PrizePicksProjection): string | null {
  if (isComboStatProjection(projection)) return null;
  const hay = normalizeMatchText(`${projection.statDisplayName} ${projection.statType}`);
  for (const { key, patterns } of STAT_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(hay))) return key;
  }
  if (/\bpts\b/i.test(hay) && !/[+/&]/.test(hay)) return "points";
  return null;
}

function statKeyForMarket(market: PolymarketMarketSummary): string | null {
  const smt = market.sportsMarketType.toLowerCase();
  for (const { key } of STAT_KEYWORDS) {
    if (smt.includes(`_${key}`) || smt.includes(`player_${key}`)) return key;
  }
  const hay = normalizeMatchText(`${market.question} ${market.description} ${market.sportsMarketType}`);
  for (const { key, patterns } of STAT_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(hay))) return key;
  }
  return null;
}

function sportMatches(projection: PrizePicksProjection, market: PolymarketMarketSummary): boolean {
  if (!market.sportTags.length) return false;

  const projectionTags = projectionSportTags(projection);
  const hay = normalizeMatchText(
    `${market.question} ${market.slug} ${market.sportsMarketType} ${market.sportTags.join(" ")}`
  );

  for (const tag of projectionTags) {
    if (market.sportTags.some((marketTag) => normalizeMatchText(marketTag) === normalizeMatchText(tag))) {
      return true;
    }
    const aliases = SPORT_ALIASES[tag] ?? [normalizeMatchText(tag)];
    if (aliases.some((alias) => hay.includes(alias))) return true;
  }

  return false;
}

function nameMatchScore(playerName: string, marketText: string): number {
  const normalizedPlayer = normalizeMatchText(playerName);
  const tokens = normalizedPlayer.split(" ").filter(Boolean);
  if (!tokens.length) return 0;

  const hay = normalizeMatchText(marketText);
  const lastName = tokens[tokens.length - 1]!;
  if (!hay.includes(lastName)) return 0;

  let score = 45;
  if (tokens.length >= 2 && hay.includes(tokens[0]!)) score += 25;
  if (hay.includes(normalizedPlayer)) score += 20;
  return Math.min(100, score);
}

function marketHaystack(market: PolymarketMarketSummary): string {
  return [market.question, market.description, market.sportsMarketType, market.slug]
    .filter(Boolean)
    .join(" ");
}

function scoreMarketMatch(params: {
  projection: PrizePicksProjection;
  side: EdgePickSide;
  market: PolymarketMarketSummary;
}): { score: number; pickedSide: "yes" | "no" } | null {
  if (!sportMatches(params.projection, params.market)) return null;

  const hay = marketHaystack(params.market);
  if (isComboStatProjection(params.projection) && !comboStatAllowedInMarket(params.projection, hay)) {
    return null;
  }
  if (!passesBinaryScorerGate(params.projection, hay)) return null;
  if (!passesHardLineGate(params.projection.lineScore, hay)) return null;

  const statKey = statKeyForProjection(params.projection);
  const marketStatKey = statKeyForMarket(params.market);
  if (!statKey || !marketStatKey || statKey !== marketStatKey) return null;

  const playerScore = nameMatchScore(params.projection.playerName, hay);
  if (playerScore < 38) return null;

  const lineScore = thresholdMatchScore(params.projection.lineScore, hay);
  const matchScore = Math.round(playerScore * 0.45 + lineScore * 0.35 + 100 * 0.2);

  const pickedSide = inferSideForPick({
    side: params.side,
    lineScore: params.projection.lineScore,
    marketText: hay,
  });
  if (!pickedSide) return null;

  return { score: matchScore, pickedSide };
}

export function findBestPolymarketMatch(params: {
  projection: PrizePicksProjection;
  side: EdgePickSide;
  markets: PolymarketMarketSummary[];
}): EdgePolymarketMatch | null {
  let best: EdgePolymarketMatch | null = null;

  for (const market of params.markets) {
    const scored = scoreMarketMatch({
      projection: params.projection,
      side: params.side,
      market,
    });
    if (!scored || scored.score < 50) continue;

    const candidate: EdgePolymarketMatch = {
      conditionId: market.conditionId,
      marketTitle: market.question || market.slug || market.conditionId,
      pickedSide: scored.pickedSide,
      matchScore: scored.score,
      market,
    };

    if (!best || candidate.matchScore > best.matchScore) {
      best = candidate;
    }
  }

  return best;
}

export function buildPolymarketPickCandidate(params: {
  projection: PrizePicksProjection;
  side: EdgePickSide;
  markets: PolymarketMarketSummary[];
}): {
  polymarket: EdgePolymarketMatch | null;
  prizepicksImpliedProb: number;
  polymarketImpliedProb: number | null;
  adjustedProb: number | null;
  edgePercent: number | null;
  confidenceScore: number;
} {
  const polymarket = findBestPolymarketMatch({
    projection: params.projection,
    side: params.side,
    markets: params.markets,
  });
  const prizepicksImpliedProb = prizepicksImpliedProbability({
    oddsType: params.projection.oddsType,
    side: params.side,
  });

  if (!polymarket) {
    return {
      polymarket: null,
      prizepicksImpliedProb,
      polymarketImpliedProb: null,
      adjustedProb: null,
      edgePercent: null,
      confidenceScore: 18,
    };
  }

  const polymarketImpliedProb = polymarketSideImpliedProbability({
    yesPrice: polymarket.market.yesPrice,
    noPrice: polymarket.market.noPrice,
    pickedSide: polymarket.pickedSide,
  });
  if (polymarketImpliedProb === null) {
    return {
      polymarket,
      prizepicksImpliedProb,
      polymarketImpliedProb: null,
      adjustedProb: null,
      edgePercent: null,
      confidenceScore: Math.round(polymarket.matchScore * 0.35),
    };
  }

  const adjustedProb = adjustedProbability({
    kalshiImpliedProb: polymarketImpliedProb,
    matchScore: polymarket.matchScore,
  });
  const edge = edgePercent({ adjustedProb, prizepicksImpliedProb });
  const volume = Number.parseFloat(polymarket.market.volume);
  const volumeBoost = Number.isFinite(volume) ? Math.min(15, Math.log10(volume + 1) * 5) : 0;
  const confidenceScore = confidenceFromMatchQuality({
    matchScore: polymarket.matchScore,
    volumeBoost,
  });

  return {
    polymarket,
    prizepicksImpliedProb,
    polymarketImpliedProb,
    adjustedProb,
    edgePercent: edge,
    confidenceScore,
  };
}
