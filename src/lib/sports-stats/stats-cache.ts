import {
  quantStatsCacheKey,
  readQuantJson,
  writeQuantJson,
} from "@/lib/quant-research/store";
import type { PropStatType, StatsCacheEntry } from "./types";
import { normalizePlayerName } from "./stat-mapping";

export async function readStatsCache(params: {
  playerName: string;
  stat: PropStatType;
}): Promise<StatsCacheEntry | null> {
  const key = quantStatsCacheKey(normalizePlayerName(params.playerName), params.stat);
  return readQuantJson<StatsCacheEntry>(key);
}

export async function writeStatsCache(entry: StatsCacheEntry): Promise<void> {
  const key = quantStatsCacheKey(normalizePlayerName(entry.playerName), entry.stat);
  await writeQuantJson(key, entry);
}

export function rollingAverageFromCache(
  entry: StatsCacheEntry | null,
  preferred: "l10" | "l5" = "l10"
): number | null {
  if (!entry) return null;
  if (preferred === "l10" && entry.l10 !== null) return entry.l10;
  if (entry.l5 !== null) return entry.l5;
  return entry.l10;
}
