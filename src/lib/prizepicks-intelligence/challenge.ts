import type { GrokChange } from "./types";

const NARRATIVE =
  /\b(hot streak|cold streak|due|revenge|must-win|confidence|birthday|national tv|season average|above (his|her|the) (average|projection)|vibes?)\b/i;

export function thesisSurvivesChallenge(change: GrokChange): { ok: boolean; reason?: string } {
  const bull = change.bullCase?.trim() ?? "";
  const bear = change.bearCase?.trim() ?? "";
  const priced = change.alreadyPricedArgument?.trim() ?? "";
  const missing = change.missingEvidence?.trim() ?? "";
  const invalidation = change.invalidationCondition?.trim() ?? "";
  if (!bull || !bear || !priced || !missing || !invalidation) {
    return { ok: false, reason: "Thesis challenge incomplete." };
  }
  if (change.invalidationAlreadyApplies === true) {
    return { ok: false, reason: `Invalidation already applies: ${invalidation}` };
  }
  if (NARRATIVE.test(`${change.whatChanged} ${change.whyNow} ${change.whyItMatters ?? ""} ${bull}`)) {
    return { ok: false, reason: "Narrative / streak / due logic is not a causal change." };
  }
  return { ok: true };
}
