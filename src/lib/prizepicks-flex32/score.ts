import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import {
  FLEX32_MAX_DEMON_GAP,
  isAllowedStat,
  LEAGUE_ID_TO_SPORT,
  normalizeOddsBucket,
  normalizeStat,
} from "./config";
import type { Flex32Candidate, Flex32OddsBucket } from "./types";

function playerStatKey(p: PrizePicksProjection): string {
  return `${p.leagueId}::${p.playerName.trim().toLowerCase()}::${normalizeStat(p.statDisplayName || p.statType)}`;
}

function isComboPlayer(name: string): boolean {
  return /\+/.test(name);
}

function isUpcoming(startTime: string, nowMs: number, horizonHours: number): boolean {
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) return false;
  if (start <= nowMs - 5 * 60_000) return false; // already tipped (5m grace)
  if (start > nowMs + horizonHours * 3600_000) return false;
  return true;
}

function sportFor(p: PrizePicksProjection): string | null {
  const fromId = LEAGUE_ID_TO_SPORT[String(p.leagueId)];
  if (fromId) return fromId;
  const name = String(p.leagueName || "").trim().toUpperCase();
  if (name === "MLB" || name === "WNBA" || name === "NBA" || name === "NFL") return name;
  return null;
}

/**
 * Match the manual strategy: soft reb / ast / K / reception floors beat
 * fat point-discount goblins (e.g. 15.5 when the main is 23.5).
 */
function statWeight(stat: string): number {
  const n = normalizeStat(stat);
  if (n === "rebounds" || n === "assists") return 1.45;
  if (n === "ks" || n === "strikeouts" || n === "pitcher strikeouts" || n === "receptions") {
    return 1.35;
  }
  if (n === "points") return 0.75;
  return 0.9;
}

/** Diminishing returns past ~4 points under the main — huge gaps ≠ safer. */
function cappedGapBonus(gap: number): number {
  const soft = Math.min(Math.max(gap, 0), 4);
  const extra = Math.max(gap - 4, 0);
  return soft * 14 + extra * 3;
}

/**
 * Softness is relative to the same player/stat main (standard) on the board.
 * Goblins far under the main score highest. Soft standards are low absolute mains
 * for that stat family. Mild demons sit just above the main.
 */
export function buildFlex32Candidates(
  projections: PrizePicksProjection[],
  options: {
    nowMs?: number;
    horizonHours: number;
    sports: string[];
    allowDemon?: boolean;
  }
): Flex32Candidate[] {
  const nowMs = options.nowMs ?? Date.now();
  const sportSet = new Set(options.sports.map((s) => s.toUpperCase()));
  const allowDemon = options.allowDemon !== false;

  const eligible = projections.filter((p) => {
    if (isComboPlayer(p.playerName || "")) return false;
    if (String(p.status || "").toLowerCase() === "inactive") return false;
    if (!isAllowedStat(p.statDisplayName || p.statType || "")) return false;
    const sport = sportFor(p);
    if (!sport || !sportSet.has(sport)) return false;
    if (!isUpcoming(p.startTime, nowMs, options.horizonHours)) return false;
    return normalizeOddsBucket(p.oddsType) != null;
  });

  const byKey = new Map<string, PrizePicksProjection[]>();
  for (const p of eligible) {
    const key = playerStatKey(p);
    const arr = byKey.get(key) ?? [];
    arr.push(p);
    byKey.set(key, arr);
  }

  // Median standard line per sport+stat — used to judge whether a standard is "soft".
  const standardLinesByStat = new Map<string, number[]>();
  for (const p of eligible) {
    if (normalizeOddsBucket(p.oddsType) !== "standard") continue;
    const sport = sportFor(p)!;
    const key = `${sport}::${normalizeStat(p.statDisplayName || p.statType)}`;
    const arr = standardLinesByStat.get(key) ?? [];
    arr.push(Number(p.lineScore));
    standardLinesByStat.set(key, arr);
  }
  const medianStandard = new Map<string, number>();
  for (const [key, lines] of standardLinesByStat) {
    const sorted = [...lines].sort((a, b) => a - b);
    medianStandard.set(key, sorted[Math.floor(sorted.length / 2)]!);
  }

  // Per-player role signal from their own standard mains (filters bench fluff).
  const roleByPlayer = new Map<string, { points: number; reb: number; ast: number; ks: number; rec: number }>();
  for (const p of eligible) {
    if (normalizeOddsBucket(p.oddsType) !== "standard") continue;
    const key = `${p.leagueId}::${p.playerName.trim().toLowerCase()}`;
    const role = roleByPlayer.get(key) ?? { points: 0, reb: 0, ast: 0, ks: 0, rec: 0 };
    const stat = normalizeStat(p.statDisplayName || p.statType);
    const line = Number(p.lineScore);
    if (stat === "points") role.points = Math.max(role.points, line);
    if (stat === "rebounds") role.reb = Math.max(role.reb, line);
    if (stat === "assists") role.ast = Math.max(role.ast, line);
    if (stat === "ks" || stat === "strikeouts" || stat === "pitcher strikeouts") {
      role.ks = Math.max(role.ks, line);
    }
    if (stat === "receptions") role.rec = Math.max(role.rec, line);
    roleByPlayer.set(key, role);
  }

  function isCrediblePlayer(p: PrizePicksProjection): boolean {
    const role = roleByPlayer.get(`${p.leagueId}::${p.playerName.trim().toLowerCase()}`);
    if (!role) return false;
    return (
      role.points >= 10 ||
      role.reb >= 4 ||
      role.ast >= 3.5 ||
      role.ks >= 2.5 ||
      role.rec >= 2.5
    );
  }

  function goblinMainCredible(stat: string, mainLine: number): boolean {
    const n = normalizeStat(stat);
    if (n === "points") return mainLine >= 14;
    if (n === "rebounds") return mainLine >= 6;
    if (n === "assists") return mainLine >= 4;
    if (n === "ks" || n === "strikeouts" || n === "pitcher strikeouts") return mainLine >= 2.5;
    if (n === "receptions") return mainLine >= 3;
    if (n.includes("yards")) return mainLine >= 25;
    return mainLine >= 5;
  }

  const out: Flex32Candidate[] = [];

  for (const [, group] of byKey) {
    const main = group
      .filter((p) => normalizeOddsBucket(p.oddsType) === "standard")
      .sort((a, b) => Number(a.lineScore) - Number(b.lineScore))[0];
    const mainLine = main ? Number(main.lineScore) : null;
    const sport = sportFor(group[0]!)!;
    const statKey = `${sport}::${normalizeStat(group[0]!.statDisplayName || group[0]!.statType)}`;
    const med = medianStandard.get(statKey) ?? null;
    const weight = statWeight(group[0]!.statDisplayName || "");

    for (const p of group) {
      if (!isCrediblePlayer(p)) continue;
      const bucket = normalizeOddsBucket(p.oddsType) as Flex32OddsBucket;
      const line = Number(p.lineScore);
      if (!Number.isFinite(line)) continue;

      const reasons: string[] = [];
      let softness = 0;
      let gapFromMain: number | null = mainLine != null ? line - mainLine : null;

      if (bucket === "goblin") {
        if (mainLine == null) continue;
        if (!goblinMainCredible(p.statDisplayName || "", mainLine)) continue;
        const gap = mainLine - line;
        if (gap < 0.5) continue; // not meaningfully under main
        softness = 55 + cappedGapBonus(gap) + weight * 18;
        // Absolute floor bump (8.5 reb / 2.5 K style).
        if (line <= 5.5) softness += 6;
        if (line <= 3.5) softness += 4;
        reasons.push(`goblin ${gap.toFixed(1)} under main ${mainLine}`);
      } else if (bucket === "standard") {
        // Soft standard = low vs peer mains for same sport/stat.
        if (med != null && med > 0) {
          const rel = (med - line) / med;
          softness = 42 + rel * 35 + weight * 16;
          reasons.push(`standard vs median ${med} (${(rel * 100).toFixed(0)}% softer)`);
        } else {
          softness = 40 + Math.max(0, 10 - line) + weight * 12;
          reasons.push("standard (no peer median)");
        }
        // Tiny absolute floors get a bump (0.5 ast, 2.5 reb, etc.).
        if (line <= 3.5) {
          softness += 12;
          reasons.push("low absolute main");
        } else if (line <= 5.5) {
          softness += 5;
        }
        const st = normalizeStat(p.statDisplayName || "");
        // Big-man 0.5/1.5 assist mains look soft and miss often — skip.
        if (st === "assists" && line < 3) continue;
        // Ultra-low reb mains need a real role elsewhere.
        if (st === "rebounds" && line <= 1.5) {
          const role = roleByPlayer.get(`${p.leagueId}::${p.playerName.trim().toLowerCase()}`);
          if (!role || (role.points < 11 && role.reb < 5)) continue;
        }
        // Points mains are rarely "most likely" standards.
        if (st === "points" && line >= 15) {
          softness -= 12;
        }
      } else if (bucket === "demon") {
        if (!allowDemon) continue;
        if (mainLine == null) continue;
        const gap = line - mainLine;
        if (gap <= 0 || gap > FLEX32_MAX_DEMON_GAP) continue;
        softness = 30 + (FLEX32_MAX_DEMON_GAP - gap) * 12 + weight * 10;
        gapFromMain = gap;
        reasons.push(`mild demon +${gap} over main ${mainLine}`);
      } else {
        continue;
      }

      out.push({
        projection: p,
        bucket,
        sport,
        softnessScore: Math.round(softness * 10) / 10,
        mainLine,
        gapFromMain,
        reasons,
      });
    }
  }

  return out.sort((a, b) => b.softnessScore - a.softnessScore);
}
