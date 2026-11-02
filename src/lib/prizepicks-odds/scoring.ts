export type SettlementRow = {
  propId: string;
  sport: string;
  stat: string;
  oddsType: string;
  probability: number;
  hit: 0 | 1 | "push" | "void";
  modelVersion: string;
  predictedAt: string;
  settledAt: string;
  closingLine: number | null;
  probabilitySource?: "direct" | "interpolated" | "unknown";
  research?: "pregame" | "postgame" | "none";
  evidenceQuality?: "high" | "moderate" | "limited";
  rank?: number;
};

export type ScoreReport = {
  sampleSize: number;
  excludedPushes: number;
  brier: number | null;
  logLoss: number | null;
  bySport: Record<string, { sampleSize: number; brier: number | null }>;
  byStat: Record<string, { sampleSize: number; brier: number | null }>;
  byOddsType: Record<string, { sampleSize: number; brier: number | null }>;
  byProbabilitySource: Record<string, { sampleSize: number; brier: number | null }>;
  byResearch: Record<string, { sampleSize: number; brier: number | null }>;
  buckets: Array<{ from: number; to: number; count: number; hits: number; averageProbability: number | null }>;
  roi: null;
  profitabilityClaim: null;
  note: string;
  hitRate: number | null;
  meaningful: boolean;
  byEvidence: Record<string, { sampleSize: number; hits: number; hitRate: number | null }>;
  top: { top1: RankSlice; top3: RankSlice; top5: RankSlice };
};

export const MIN_MEANINGFUL_SAMPLE = 30;

type RankSlice = { sampleSize: number; hits: number; hitRate: number | null };

const BUCKETS = [
  [0, 40],
  [40, 50],
  [50, 60],
  [60, 70],
  [70, 100],
] as const;

export function scoreSettlements(rows: SettlementRow[]): ScoreReport {
  const graded = rows.filter((row) => row.hit === 0 || row.hit === 1);
  const group = (keyOf: (row: SettlementRow) => string) => {
    const out: Record<string, { sampleSize: number; brier: number | null }> = {};
    const buckets = new Map<string, SettlementRow[]>();
    for (const row of graded) {
      const key = keyOf(row);
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets) {
      out[key] = { sampleSize: list.length, brier: brierScore(list) };
    }
    return out;
  };
  return {
    sampleSize: graded.length,
    excludedPushes: rows.length - graded.length,
    brier: brierScore(graded),
    logLoss: logLoss(graded),
    bySport: group((row) => row.sport),
    byStat: group((row) => row.stat),
    byOddsType: group((row) => row.oddsType),
    byProbabilitySource: group((row) => row.probabilitySource ?? "unknown"),
    byResearch: group((row) => row.research ?? "none"),
    buckets: BUCKETS.map(([from, to]) => {
      const list = graded.filter((row) => row.probability >= from && row.probability < to);
      const hits = list.filter((row) => row.hit === 1).length;
      const average =
        list.length === 0 ? null : Math.round((list.reduce((sum, row) => sum + row.probability, 0) / list.length) * 10) / 10;
      return { from, to, count: list.length, hits, averageProbability: average };
    }),
    roi: null,
    profitabilityClaim: null,
    hitRate: graded.length ? graded.filter((row) => row.hit === 1).length / graded.length : null,
    meaningful: graded.length >= MIN_MEANINGFUL_SAMPLE,
    byEvidence: evidenceGroups(graded),
    top: {
      top1: rankSlice(graded, 1),
      top3: rankSlice(graded, 3),
      top5: rankSlice(graded, 5),
    },
    note:
      graded.length === 0
        ? "No settled props. This is not a result."
        : graded.length < MIN_MEANINGFUL_SAMPLE
          ? `Scores describe past probability errors. The sample of ${graded.length} is too small to call the system proven. ROI is withheld.`
          : "Scores describe past probability errors. Payout ROI is withheld because no verified payout is attached to these rows.",
  };
}

function evidenceGroups(rows: Array<SettlementRow & { hit: 0 | 1 }>): ScoreReport["byEvidence"] {
  const out: ScoreReport["byEvidence"] = {};
  for (const row of rows) {
    const key = row.evidenceQuality ?? "unknown";
    const current = out[key] ?? { sampleSize: 0, hits: 0, hitRate: null };
    current.sampleSize += 1;
    if (row.hit === 1) current.hits += 1;
    current.hitRate = current.hits / current.sampleSize;
    out[key] = current;
  }
  return out;
}

function rankSlice(rows: Array<SettlementRow & { hit: 0 | 1 }>, maxRank: number): { sampleSize: number; hits: number; hitRate: number | null } {
  const list = rows.filter((row) => row.rank != null && row.rank <= maxRank);
  const hits = list.filter((row) => row.hit === 1).length;
  return { sampleSize: list.length, hits, hitRate: list.length ? hits / list.length : null };
}

export function brierScore(rows: Array<{ probability: number; hit: 0 | 1 | "push" | "void" }>): number | null {
  const graded = rows.filter((row): row is { probability: number; hit: 0 | 1 } => row.hit === 0 || row.hit === 1);
  if (!graded.length) return null;
  const total = graded.reduce((sum, row) => {
    const p = row.probability / 100;
    return sum + (p - row.hit) ** 2;
  }, 0);
  return Math.round((total / graded.length) * 1000) / 1000;
}

export function logLoss(rows: Array<{ probability: number; hit: 0 | 1 | "push" | "void" }>): number | null {
  const graded = rows.filter((row): row is { probability: number; hit: 0 | 1 } => row.hit === 0 || row.hit === 1);
  if (!graded.length) return null;
  const total = graded.reduce((sum, row) => {
    const p = Math.min(0.999, Math.max(0.001, row.probability / 100));
    return sum + (row.hit === 1 ? -Math.log(p) : -Math.log(1 - p));
  }, 0);
  return Math.round((total / graded.length) * 1000) / 1000;
}
