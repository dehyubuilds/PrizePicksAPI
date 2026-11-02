import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceBundleKey,
  evidenceSha256,
  validateSportsDailyEvidenceBundle,
  type SportsDailyEvidenceBundle,
} from "../src/lib/sports-daily/evidence-bundle";

function fixture(): SportsDailyEvidenceBundle {
  return {
    schemaVersion: 1,
    bundleId: "sdeb_fixture",
    createdAt: "2026-11-01T18:00:00.000Z",
    observedAt: "2026-11-01T17:55:00.000Z",
    predictionCutoffAt: "2026-11-01T18:00:00.000Z",
    league: "NBA",
    slateDate: "2026-11-01",
    sourceObjects: [{ provider: "prizepicks", observedAt: "2026-11-01T17:55:00.000Z" }],
    claims: [],
    candidates: [
      {
        candidateId: "candidate_1",
        player: {
          canonicalId: "nba:player:1",
          displayName: "Example Player",
          externalIds: { provider: "1" },
        },
        event: {
          canonicalId: "nba:event:1",
          startAt: "2026-11-02T00:00:00.000Z",
          externalIds: { provider: "event-1" },
        },
        stat: { canonicalKey: "points", displayName: "Points" },
        postedLine: {
          value: 22.5,
          projectionId: "projection-1",
          observedAt: "2026-11-01T17:55:00.000Z",
          onAirLabel: "the posted line",
        },
        contextualClaimIds: [],
        limitations: ["No verified lineup report"],
      },
    ],
    limitations: [],
  };
}

test("validates a point-in-time evidence bundle", () => {
  const result = validateSportsDailyEvidenceBundle(fixture());
  assert.equal(result.ok, true);
});

test("rejects observations after the cutoff", () => {
  const value = fixture();
  value.candidates[0].postedLine.observedAt = "2026-11-01T18:01:00.000Z";
  const result = validateSportsDailyEvidenceBundle(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("\n"), /after predictionCutoffAt/);
});

test("builds immutable partitioned keys and stable digests", () => {
  const value = fixture();
  assert.equal(
    evidenceBundleKey(value),
    "aotq/sports-daily/evidence-bundles/2026/11/01/sdeb_fixture.json"
  );
  assert.equal(evidenceSha256("same"), evidenceSha256("same"));
  assert.equal(evidenceSha256("same").length, 64);
});
