import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { prizepicksApiBaseUrl } from "@/lib/prizepicks/config";
import type { PrizePicksFetchResult, PrizePicksProjection } from "@/lib/prizepicks/types";
import {
  quantSnapshotKey,
  quantSnapshotLatestKey,
  writeQuantJson,
} from "./store";

/** Append-only PrizePicks board snapshot for quant research + Dropflow consumers. */
export type PrizePicksBoardSnapshot = {
  schemaVersion: 1;
  source: "prizepicks";
  /** When this snapshot was persisted (ISO). Use for point-in-time joins. */
  observedAt: string;
  /** When the live API response was fetched. */
  fetchedAt: string;
  apiBaseUrl: string;
  fromCache: boolean;
  projectionCount: number;
  leagueCount: number;
  /** S3 object key when uploaded. */
  s3Key?: string;
  s3Bucket?: string;
  projections: PrizePicksProjection[];
};

export type PersistPrizePicksSnapshotOptions = {
  /** Also write under tmp/prizepicks/snapshots/ (default true). */
  writeLocal?: boolean;
  /** Also update quant/prizepicks/snapshots/latest.json pointer (default true). */
  writeLatestPointer?: boolean;
  /** Skip S3 (local only). */
  localOnly?: boolean;
  rootDir?: string;
};

export type PersistPrizePicksSnapshotResult = {
  snapshot: PrizePicksBoardSnapshot;
  s3Key: string | null;
  localPath: string | null;
};

export function buildPrizePicksBoardSnapshot(
  result: PrizePicksFetchResult,
  observedAt = new Date().toISOString()
): PrizePicksBoardSnapshot {
  return {
    schemaVersion: 1,
    source: "prizepicks",
    observedAt,
    fetchedAt: result.fetchedAt,
    apiBaseUrl: prizepicksApiBaseUrl(),
    fromCache: Boolean(result.fromCache),
    projectionCount: result.projections.length,
    leagueCount: result.leagueCount,
    projections: result.projections,
  };
}

function localSnapshotPath(rootDir: string, observedAt: string): string {
  const safe = observedAt.replace(/[:.]/g, "-");
  return path.join(rootDir, "tmp", "prizepicks", "snapshots", `${safe}.json`);
}

/**
 * Persist an append-only board snapshot to S3 (Dropflow tracks bucket) and optionally local disk.
 * Does not overwrite prior timestamped objects — only `latest.json` is a mutable pointer.
 */
export async function persistPrizePicksBoardSnapshot(
  result: PrizePicksFetchResult,
  options: PersistPrizePicksSnapshotOptions = {}
): Promise<PersistPrizePicksSnapshotResult> {
  const writeLocal = options.writeLocal !== false;
  const writeLatestPointer = options.writeLatestPointer !== false;
  const localOnly = options.localOnly === true;
  const rootDir = options.rootDir ?? process.cwd();

  const observedAt = new Date().toISOString();
  const snapshot = buildPrizePicksBoardSnapshot(result, observedAt);
  const s3Key = quantSnapshotKey(observedAt);

  let uploadedKey: string | null = null;
  if (!localOnly) {
    const doc: PrizePicksBoardSnapshot = {
      ...snapshot,
      s3Bucket: config.dropflow.bucket,
      s3Key,
    };
    await writeQuantJson(s3Key, doc);
    if (writeLatestPointer) {
      await writeQuantJson(quantSnapshotLatestKey(), {
        schemaVersion: 1,
        source: "prizepicks",
        observedAt: doc.observedAt,
        fetchedAt: doc.fetchedAt,
        projectionCount: doc.projectionCount,
        leagueCount: doc.leagueCount,
        s3Bucket: doc.s3Bucket,
        s3Key: doc.s3Key,
        note: "Mutable pointer to the newest append-only snapshot. Prefer timestamped keys for history.",
      });
    }
    uploadedKey = s3Key;
    snapshot.s3Bucket = config.dropflow.bucket;
    snapshot.s3Key = s3Key;
  }

  let localPath: string | null = null;
  if (writeLocal) {
    localPath = localSnapshotPath(rootDir, observedAt);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const latestLocal = path.join(rootDir, "tmp", "prizepicks", "snapshots", "latest.json");
    fs.writeFileSync(
      latestLocal,
      `${JSON.stringify(
        {
          observedAt: snapshot.observedAt,
          fetchedAt: snapshot.fetchedAt,
          projectionCount: snapshot.projectionCount,
          leagueCount: snapshot.leagueCount,
          s3Key: snapshot.s3Key ?? null,
          localPath,
        },
        null,
        2
      )}\n`
    );
  }

  return { snapshot, s3Key: uploadedKey, localPath };
}
