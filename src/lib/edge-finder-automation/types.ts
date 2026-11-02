import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { DailyModelPickMeta } from "@/lib/daily-picks-engine/types";

export type EdgeFinderSlot = "morning" | "afternoon" | "primetime";

export type EdgeFinderAutomationStep = "edge_scan" | "edge_post_demon_x";

export type EdgeFinderSlotStatus = "pending" | "running" | "complete" | "skipped" | "failed";

export type EdgeFinderSlotRun = {
  slot: EdgeFinderSlot;
  status: EdgeFinderSlotStatus;
  sessionId?: string;
  edgeCount?: number;
  demonCount?: number;
  postableCount?: number;
  postedPickId?: string;
  pickLine?: string;
  tweetUrl?: string;
  warning?: string;
  skipReason?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type EdgeFinderAutomationJobStatus = "pending" | "running" | "complete" | "failed";

export type EdgeFinderAutomationJob = {
  dayKey: string;
  executionArn?: string;
  status: EdgeFinderAutomationJobStatus;
  currentStep?: EdgeFinderAutomationStep;
  currentSlot?: EdgeFinderSlot;
  slots: Record<EdgeFinderSlot, EdgeFinderSlotRun>;
  postedPickIds: string[];
  lastScan?: {
    sessionId: string;
    scannedAt: string;
    edgePicks: EdgeScanPick[];
    edgeCount: number;
    postableCount: number;
    /** Daily Picks Engine metadata keyed by pick id. */
    dailyPickMetas?: Record<string, DailyModelPickMeta>;
    engine?: "daily-picks" | "edge-finder";
    /** @deprecated Legacy field — same as edgePicks when only demons were stored */
    demonWatchlist?: EdgeScanPick[];
    demonCount?: number;
  };
  error?: string;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
};

export type EdgeFinderAutomationStepResult = {
  ok: boolean;
  done?: boolean;
  failed?: boolean;
  skipped?: boolean;
  error?: string;
  warning?: string;
  job: EdgeFinderAutomationJob;
};

export const EDGE_FINDER_SLOTS: EdgeFinderSlot[] = ["morning", "afternoon", "primetime"];

export const EDGE_FINDER_SLOT_LABELS: Record<EdgeFinderSlot, string> = {
  morning: "9:00 AM",
  afternoon: "2:00 PM",
  primetime: "6:30 PM",
};
