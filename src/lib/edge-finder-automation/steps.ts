import { runDailyPicksScan } from "@/lib/daily-picks-engine/scan";
import { selectLiveAvailableDailyPick } from "@/lib/daily-picks-engine/select-live-pick";
import { revalidateDailyPickAtPostTime } from "@/lib/daily-picks-engine/revalidate-pick";
import { postDailyPickToX } from "@/lib/daily-picks-engine/post-pick";
import { filterPostableDailyPicks } from "@/lib/daily-picks-engine/select-postable-pick";
import { dailyPickTweetText } from "@/lib/daily-picks-engine/pick-tweet";
import { upsertEdgeFinderAutomationJob } from "./store";
import type {
  EdgeFinderAutomationStep,
  EdgeFinderAutomationStepResult,
  EdgeFinderSlot,
} from "./types";

export type EdgeFinderAutomationSlotResult = EdgeFinderAutomationStepResult & {
  tweetUrl?: string;
  tweetPreview?: string;
  pickLine?: string;
  postedPickId?: string;
  edgeCount?: number;
  postableCount?: number;
  skipReason?: string;
  demonCount?: number;
};

async function failStep(
  job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>,
  error: string
): Promise<EdgeFinderAutomationStepResult> {
  const failedJob = await upsertEdgeFinderAutomationJob(job.dayKey, {
    status: "failed",
    error: error.slice(0, 500),
    currentStep: job.currentStep,
    currentSlot: job.currentSlot,
  });
  return { ok: false, failed: true, error, job: failedJob };
}

function scanEdgePicks(job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>) {
  return job.lastScan?.edgePicks ?? job.lastScan?.demonWatchlist ?? [];
}

function scanPickMetas(job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>) {
  return job.lastScan?.dailyPickMetas ?? {};
}

function logSkip(params: {
  dayKey: string;
  slot: EdgeFinderSlot;
  reason: string;
  postableCount?: number;
  edgeCount?: number;
}) {
  console.log(
    JSON.stringify({
      audit: "edge_finder_automation_skip_reason",
      engine: "daily-picks",
      dayKey: params.dayKey,
      slot: params.slot,
      reason: params.reason,
      postableCount: params.postableCount,
      edgeCount: params.edgeCount,
      at: new Date().toISOString(),
    })
  );
}

async function skipPostStep(
  params: { dayKey: string; slot: EdgeFinderSlot },
  job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>,
  warning: string,
  skipReason: string
): Promise<EdgeFinderAutomationStepResult> {
  logSkip({
    dayKey: params.dayKey,
    slot: params.slot,
    reason: skipReason,
    postableCount: job.lastScan?.postableCount,
    edgeCount: job.lastScan?.edgeCount,
  });

  job = await upsertEdgeFinderAutomationJob(params.dayKey, {
    status: "complete",
    currentStep: "edge_post_demon_x",
    warnings: [...(job.warnings ?? []), warning],
    slots: {
      [params.slot]: {
        ...job.slots[params.slot],
        slot: params.slot,
        status: "skipped",
        warning,
        skipReason,
        completedAt: new Date().toISOString(),
      },
    },
  });
  return { ok: true, done: true, skipped: true, warning, job };
}

export async function runEdgeFinderAutomationStep(params: {
  step: EdgeFinderAutomationStep;
  dayKey: string;
  slot: EdgeFinderSlot;
  userId: string;
  executionArn?: string;
}): Promise<EdgeFinderAutomationStepResult> {
  let job = await upsertEdgeFinderAutomationJob(params.dayKey, {
    executionArn: params.executionArn,
    status: "running",
    currentStep: params.step,
    currentSlot: params.slot,
    slots: {
      [params.slot]: {
        slot: params.slot,
        status: "running",
        startedAt: new Date().toISOString(),
      },
    },
  });

  try {
    switch (params.step) {
      case "edge_scan":
        return await stepEdgeScan(params, job);
      case "edge_post_demon_x":
        return await stepEdgePostDemonX(params, job);
      default:
        return await failStep(job, `Unknown step: ${params.step}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    job = await upsertEdgeFinderAutomationJob(params.dayKey, {
      status: "failed",
      error: message.slice(0, 500),
      currentStep: params.step,
      currentSlot: params.slot,
      slots: {
        [params.slot]: {
          ...job.slots[params.slot],
          status: "failed",
          error: message.slice(0, 500),
          completedAt: new Date().toISOString(),
        },
      },
    });
    return { ok: false, failed: true, error: message, job };
  }
}

async function stepEdgeScan(
  params: { dayKey: string; slot: EdgeFinderSlot; userId: string },
  job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>
): Promise<EdgeFinderAutomationStepResult> {
  const { sessionId, result, pickMetas } = await runDailyPicksScan({
    userId: params.userId,
    forceLivePrizePicks: true,
  });
  const edgePicks = result.picks;
  const postable = filterPostableDailyPicks(edgePicks);
  const dailyPickMetas = Object.fromEntries(pickMetas.entries());

  job = await upsertEdgeFinderAutomationJob(params.dayKey, {
    status: "running",
    currentStep: "edge_scan",
    currentSlot: params.slot,
    lastScan: {
      sessionId,
      scannedAt: result.summary.scannedAt,
      edgePicks,
      edgeCount: edgePicks.length,
      postableCount: postable.length,
      dailyPickMetas,
      engine: "daily-picks",
    },
    slots: {
      [params.slot]: {
        ...job.slots[params.slot],
        slot: params.slot,
        status: "running",
        sessionId,
        edgeCount: edgePicks.length,
        demonCount: edgePicks.length,
        postableCount: postable.length,
      },
    },
  });

  return { ok: true, done: true, job };
}

async function stepEdgePostDemonX(
  params: { dayKey: string; slot: EdgeFinderSlot; userId: string },
  job: Awaited<ReturnType<typeof upsertEdgeFinderAutomationJob>>
): Promise<EdgeFinderAutomationStepResult> {
  const edgePicks = scanEdgePicks(job);
  if (!edgePicks.length) {
    return skipPostStep(
      params,
      job,
      "No model picks from scan — skipping X post.",
      "no_scan_picks"
    );
  }

  const candidate = await selectLiveAvailableDailyPick({
    picks: edgePicks,
    pickMetas: scanPickMetas(job),
    postedPickIds: job.postedPickIds,
  });

  if (!candidate) {
    return skipPostStep(
      params,
      job,
      "No qualifying standard pick on PrizePicks right now (live pre-game standard line required).",
      "no_live_standard_pick"
    );
  }

  const revalidated = await revalidateDailyPickAtPostTime(candidate.pick, candidate.meta);
  if (!revalidated.pick || !revalidated.meta) {
    const reason = revalidated.reason ?? "post_time_revalidation_failed";
    return skipPostStep(
      params,
      job,
      `Pick failed post-time quality check (${reason}) — skipping X post.`,
      reason
    );
  }

  const pick = revalidated.pick;
  const meta = revalidated.meta;
  const posted = await postDailyPickToX({
    userId: params.userId,
    pick,
    meta,
    dayKey: params.dayKey,
    slot: params.slot,
  });
  if ("error" in posted) {
    return await failStep(job, posted.error);
  }

  const postedPickIds = [...job.postedPickIds, pick.id];
  job = await upsertEdgeFinderAutomationJob(params.dayKey, {
    status: "complete",
    currentStep: "edge_post_demon_x",
    postedPickIds,
    slots: {
      [params.slot]: {
        ...job.slots[params.slot],
        slot: params.slot,
        status: "complete",
        postedPickId: pick.id,
        pickLine: pick.pickLine,
        tweetUrl: posted.tweetUrl,
        completedAt: new Date().toISOString(),
      },
    },
  });

  console.log(
    JSON.stringify({
      audit: "edge_finder_automation_post_daily_pick_x",
      engine: "daily-picks",
      dayKey: params.dayKey,
      slot: params.slot,
      pickId: pick.id,
      playerName: pick.playerName,
      oddsType: pick.oddsType,
      modelEdgePercent: meta.modelEdgePercent,
      finalEdgePercent: pick.edgePercent,
      venueAlignment: meta.venueAlignment,
      tweetUrl: posted.tweetUrl,
      at: new Date().toISOString(),
    })
  );

  return { ok: true, done: true, job };
}

export async function runEdgeFinderAutomationSlot(params: {
  dayKey: string;
  slot: EdgeFinderSlot;
  userId: string;
}): Promise<EdgeFinderAutomationSlotResult> {
  const scanResult = await runEdgeFinderAutomationStep({
    step: "edge_scan",
    dayKey: params.dayKey,
    slot: params.slot,
    userId: params.userId,
  });
  if (!scanResult.ok || scanResult.failed) {
    return {
      ...scanResult,
      edgeCount: scanResult.job.lastScan?.edgeCount,
      postableCount: scanResult.job.lastScan?.postableCount,
      demonCount: scanResult.job.lastScan?.edgeCount,
    };
  }

  const postResult = await runEdgeFinderAutomationStep({
    step: "edge_post_demon_x",
    dayKey: params.dayKey,
    slot: params.slot,
    userId: params.userId,
  });

  const slotRun = postResult.job.slots[params.slot];
  const postedPick =
    slotRun?.postedPickId
      ? scanEdgePicks(postResult.job).find((row) => row.id === slotRun.postedPickId)
      : null;

  const previewPick =
    postedPick ??
    (scanEdgePicks(postResult.job).length
      ? await selectLiveAvailableDailyPick({
          picks: scanEdgePicks(postResult.job),
          pickMetas: scanPickMetas(postResult.job),
          postedPickIds: [],
        }).then((row) => row?.pick ?? null)
      : null);

  const previewMeta = previewPick
    ? scanPickMetas(postResult.job)[previewPick.id]
    : undefined;

  return {
    ...postResult,
    edgeCount: postResult.job.lastScan?.edgeCount,
    postableCount: postResult.job.lastScan?.postableCount,
    demonCount: postResult.job.lastScan?.edgeCount,
    skipReason: slotRun?.skipReason,
    tweetUrl: slotRun?.tweetUrl,
    tweetPreview: previewPick
      ? dailyPickTweetText(previewPick, {
          venueAlignment: previewMeta?.venueAlignment,
          venueEdgePercent: previewMeta?.venueEdgePercent,
        })
      : undefined,
    pickLine: slotRun?.pickLine ?? previewPick?.pickLine,
    postedPickId: slotRun?.postedPickId,
  };
}
