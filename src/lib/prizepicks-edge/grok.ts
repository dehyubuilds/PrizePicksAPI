import type { EdgeScanPick } from "@/lib/edge-finder/types";
import { callGrokResponses, grokConfigured, grokModel, isGrokTimeoutError } from "@/lib/xai/client";
import type { EdgePriority } from "./types";

export { grokConfigured, grokModel };

export type GrokEdgePick = {
  projectionId: string;
  side: "over" | "under";
  rank: number;
  priority: EdgePriority;
  confidence: number;
  explanation: string;
  xSignal?: string;
  veto: boolean;
  vetoReason?: string;
};

export type GrokEdgeResult = {
  model: string;
  summary?: string;
  picks: GrokEdgePick[];
};

const SYSTEM_PROMPT = `You are a research intern for PrizePicks player-prop edge. You do not set the line or invent props. You only research news/X/lineups/weather/injuries and rank the provided candidates.

Return strict JSON:
{
  "summary": string,
  "picks": [
    {
      "projectionId": string,
      "side": "over" | "under",
      "rank": number,
      "priority": "now" | "watch" | "pass",
      "confidence": number,
      "explanation": string,
      "xSignal": string,
      "veto": boolean,
      "vetoReason": string | null
    }
  ]
}

Rules:
- Use only projectionId values from the candidate list. Never invent players or lines.
- Keep the candidate's side unless news clearly kills it — then veto=true.
- priority "now" = news + venue pricing both support the side today.
- priority "watch" = interesting but thinner news or weaker match.
- priority "pass" or veto=true if injured, scratched, weather/lineup kills the stat, or Kalshi/Poly is a bad match.
- confidence is 0-100 for the PrizePicks side, not a price.
- explanation: 1-3 sentences a human can act on. Mention the news or why the venue price disagrees with PrizePicks.
- xSignal: one sentence from X/news, or "none".
- Unique ranks starting at 1. Prefer diverse games/players.
- Return at most the requested count of now/watch picks. You may return fewer.`;

function parsePick(raw: unknown, index: number): GrokEdgePick | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const projectionId = String(row.projectionId ?? "").trim();
  const sideRaw = String(row.side ?? "").trim().toLowerCase();
  const side = sideRaw === "over" || sideRaw === "under" ? sideRaw : null;
  const explanation = String(row.explanation ?? "").trim();
  if (!projectionId || !side || !explanation) return null;

  const priorityRaw = String(row.priority ?? "watch").trim().toLowerCase();
  const priority: EdgePriority =
    priorityRaw === "now" || priorityRaw === "pass" || priorityRaw === "watch"
      ? priorityRaw
      : "watch";
  const rank = Number(row.rank);
  const confidence = Number(row.confidence);
  const xSignal = String(row.xSignal ?? "").trim();
  const veto = row.veto === true || priority === "pass";

  return {
    projectionId,
    side,
    rank: Number.isFinite(rank) ? rank : index + 1,
    priority: veto ? "pass" : priority,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 50,
    explanation,
    xSignal: xSignal && xSignal.toLowerCase() !== "none" ? xSignal : undefined,
    veto,
    vetoReason: veto ? String(row.vetoReason ?? "").trim() || explanation : undefined,
  };
}

export function formatGrokCorpus(candidates: EdgeScanPick[]): string {
  return candidates
    .map((pick, index) => {
      const edge = pick.edgePercent == null ? "n/a" : `${pick.edgePercent >= 0 ? "+" : ""}${pick.edgePercent}%`;
      const kalshi = pick.kalshi
        ? `Kalshi ${pick.kalshi.ticker} ${pick.kalshi.pickedSide.toUpperCase()} match ${pick.kalshi.matchScore} implied ${pick.kalshiImpliedProb ?? "n/a"}%`
        : "Kalshi none";
      const poly = pick.polymarket
        ? `Poly "${pick.polymarket.marketTitle}" ${pick.polymarket.pickedSide.toUpperCase()} match ${pick.polymarket.matchScore} implied ${pick.polymarketImpliedProb ?? "n/a"}%`
        : "Poly none";
      return [
        `${index + 1}. id=${pick.prizepicksProjectionId} side=${pick.side}`,
        `   ${pick.pickLine} | ${pick.sport} | ${pick.oddsType} | start ${pick.startTime}`,
        `   PP implied ~${pick.prizepicksImpliedProb}% | edge ${edge} | conf ${pick.confidenceLabel}`,
        `   ${kalshi}`,
        `   ${poly}`,
        `   mechanical: ${pick.reasoning}`,
      ].join("\n");
    })
    .join("\n\n");
}

const GROK_TIMEOUT_MS = 360_000;

export async function researchEdgeCandidatesWithGrok(params: {
  candidates: EdgeScanPick[];
  pickCount: number;
}): Promise<GrokEdgeResult> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const candidates = params.candidates.slice(0, 16);
  const input = [
    `Today is ${today} (America/Chicago).`,
    `Research X + web, then return at most ${params.pickCount} PrizePicks edge opportunities from this candidate list.`,
    "Return JSON only, no markdown.",
    "",
    formatGrokCorpus(candidates),
  ].join("\n");
  let result;
  try {
    result = await callGrokResponses({
      instructions: SYSTEM_PROMPT,
      timeoutMs: GROK_TIMEOUT_MS,
      input,
    });
  } catch (err) {
    if (!isGrokTimeoutError(err)) throw err;
    result = await callGrokResponses({
      instructions: SYSTEM_PROMPT,
      timeoutMs: GROK_TIMEOUT_MS,
      input,
    });
  }

  const parsed = result.parsed as { picks?: unknown; summary?: string };
  const allowed = new Set(
    candidates.map((pick) => `${pick.prizepicksProjectionId}:${pick.side}`)
  );
  const picks = (Array.isArray(parsed.picks) ? parsed.picks : [])
    .map((row, index) => parsePick(row, index))
    .filter((pick): pick is GrokEdgePick => Boolean(pick))
    .filter((pick) => allowed.has(`${pick.projectionId}:${pick.side}`))
    .sort((a, b) => a.rank - b.rank);

  return {
    model: result.model,
    picks,
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : undefined,
  };
}
