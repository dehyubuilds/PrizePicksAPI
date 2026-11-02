import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import { chicagoDayKey } from "@/lib/chicago-time";
import {
  EDGE_FINDER_SLOTS,
  type EdgeFinderAutomationJob,
  type EdgeFinderSlot,
  type EdgeFinderSlotRun,
} from "./types";

export { chicagoDayKey };

const PREFIX = "admin/edge-finder-automation/jobs";

function s3(): S3Client {
  return new S3Client(awsClientConfig());
}

function jobKey(dayKey: string): string {
  return `${PREFIX}/${dayKey.replace(/[^0-9-]/g, "")}.json`;
}

function emptySlotRun(slot: EdgeFinderSlot): EdgeFinderSlotRun {
  return { slot, status: "pending" };
}

function defaultJob(dayKey: string, now: string): EdgeFinderAutomationJob {
  return {
    dayKey,
    status: "pending",
    slots: {
      morning: emptySlotRun("morning"),
      afternoon: emptySlotRun("afternoon"),
      primetime: emptySlotRun("primetime"),
    },
    postedPickIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: config.dropflow.bucket, Key: key })
    );
    const raw = await res.Body?.transformToString();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: config.dropflow.bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
}

export async function getEdgeFinderAutomationJob(
  dayKey: string
): Promise<EdgeFinderAutomationJob | null> {
  return readJson<EdgeFinderAutomationJob>(jobKey(dayKey));
}

export async function putEdgeFinderAutomationJob(job: EdgeFinderAutomationJob): Promise<void> {
  await writeJson(jobKey(job.dayKey), job);
}

export async function listEdgeFinderAutomationJobs(limit = 7): Promise<EdgeFinderAutomationJob[]> {
  const rows: EdgeFinderAutomationJob[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: config.dropflow.bucket,
        Prefix: `${PREFIX}/`,
        ContinuationToken: token,
      })
    );
    for (const item of res.Contents ?? []) {
      if (!item.Key?.endsWith(".json")) continue;
      const job = await readJson<EdgeFinderAutomationJob>(item.Key);
      if (job?.dayKey) rows.push(job);
    }
    token = res.NextContinuationToken;
  } while (token && rows.length < limit * 3);
  rows.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)));
  return rows.slice(0, limit);
}

export async function upsertEdgeFinderAutomationJob(
  dayKey: string,
  patch: Omit<Partial<EdgeFinderAutomationJob>, "slots"> & {
    executionArn?: string;
    slots?: Partial<Record<EdgeFinderSlot, EdgeFinderSlotRun>>;
  }
): Promise<EdgeFinderAutomationJob> {
  const now = new Date().toISOString();
  const existing = (await getEdgeFinderAutomationJob(dayKey)) ?? defaultJob(dayKey, now);
  const slots = { ...existing.slots };
  if (patch.slots) {
    for (const slot of EDGE_FINDER_SLOTS) {
      if (patch.slots[slot]) {
        slots[slot] = { ...slots[slot], ...patch.slots[slot] };
      }
    }
  }

  const job: EdgeFinderAutomationJob = {
    ...existing,
    ...patch,
    dayKey,
    slots,
    postedPickIds: patch.postedPickIds ?? existing.postedPickIds,
    updatedAt: now,
    warnings: patch.warnings ?? existing.warnings,
  };

  if (patch.status === "complete") {
    job.error = undefined;
  } else if (patch.status === "running" && !("error" in patch)) {
    job.error = undefined;
  }

  await putEdgeFinderAutomationJob(job);
  return job;
}

export function normalizeEdgeFinderSlot(raw: unknown): EdgeFinderSlot {
  const value = String(raw ?? "morning").trim().toLowerCase();
  if (value === "afternoon" || value === "primetime") return value;
  return "morning";
}
