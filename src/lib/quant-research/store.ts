import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";

const PREFIX = "quant";

function s3(): S3Client {
  return new S3Client(awsClientConfig());
}

function bucket(): string {
  return config.dropflow.bucket;
}

export async function readQuantJson<T>(key: string): Promise<T | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const raw = await res.Body?.transformToString();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeQuantJson(key: string, value: unknown): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
}

/** Write-once JSON for audit evidence. S3 rejects an existing key with HTTP 412. */
export async function writeImmutableQuantJson(
  key: string,
  value: unknown,
  options: { kmsKeyId?: string } = {}
): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
      IfNoneMatch: "*",
      ServerSideEncryption: options.kmsKeyId ? "aws:kms" : "AES256",
      ...(options.kmsKeyId ? { SSEKMSKeyId: options.kmsKeyId } : {}),
      Metadata: {
        dataClassification: "confidential-research",
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    })
  );
}

export async function listQuantKeys(prefix: string, maxKeys = 500): Promise<string[]> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: prefix,
      MaxKeys: maxKeys,
    })
  );
  return (res.Contents ?? []).map((row) => row.Key).filter((key): key is string => Boolean(key));
}

/**
 * Append-only snapshot key, partitioned by UTC date for Dropflow / Athena-friendly listing.
 * Example: quant/prizepicks/snapshots/2026/11/01/2026-11-01T20-00-00-000Z.json
 */
export function quantSnapshotKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const yyyy = Number.isFinite(date.getTime())
    ? String(date.getUTCFullYear())
    : "unknown";
  const mm = Number.isFinite(date.getTime())
    ? String(date.getUTCMonth() + 1).padStart(2, "0")
    : "00";
  const dd = Number.isFinite(date.getTime())
    ? String(date.getUTCDate()).padStart(2, "0")
    : "00";
  const safe = isoTimestamp.replace(/[:.]/g, "-");
  return `${PREFIX}/prizepicks/snapshots/${yyyy}/${mm}/${dd}/${safe}.json`;
}

/** Mutable pointer to the newest snapshot (not a substitute for history). */
export function quantSnapshotLatestKey(): string {
  return `${PREFIX}/prizepicks/snapshots/latest.json`;
}

export function quantPredictionKey(pickId: string): string {
  return `${PREFIX}/picks/predictions/${pickId}.json`;
}

export function quantOutcomeKey(pickId: string): string {
  return `${PREFIX}/picks/outcomes/${pickId}.json`;
}

export function quantStatsCacheKey(playerKey: string, statKey: string): string {
  const safePlayer = playerKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const safeStat = statKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `${PREFIX}/stats/cache/${safePlayer}/${safeStat}.json`;
}

export function quantAggregatesKey(version = "v1"): string {
  return `${PREFIX}/research/aggregates/${version}.json`;
}

export function quantModelWeightsKey(version = "v1"): string {
  return `${PREFIX}/research/model-weights/${version}.json`;
}

export function quantPlayerIdCacheKey(playerName: string): string {
  const safe = playerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return `${PREFIX}/stats/player-ids/${safe}.json`;
}
