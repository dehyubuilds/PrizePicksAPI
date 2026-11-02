import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import type { PrizePicksFetchResult, PrizePicksProjection } from "./types";

const CACHE_KEY = "admin/prizepicks/projections-cache.json";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

type PrizePicksCacheDoc = {
  fetchedAt: string;
  projections: PrizePicksProjection[];
  leagueCount: number;
};

function s3(): S3Client {
  return new S3Client(awsClientConfig());
}

export async function readPrizePicksCache(maxAgeMs = CACHE_TTL_MS): Promise<PrizePicksFetchResult | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: config.dropflow.bucket, Key: CACHE_KEY })
    );
    const raw = await res.Body?.transformToString();
    if (!raw) return null;
    const doc = JSON.parse(raw) as PrizePicksCacheDoc;
    if (!doc.fetchedAt || !Array.isArray(doc.projections) || !doc.projections.length) return null;
    const age = Date.now() - new Date(doc.fetchedAt).getTime();
    if (!Number.isFinite(age) || age > maxAgeMs) return null;
    return {
      projections: doc.projections,
      fetchedAt: doc.fetchedAt,
      leagueCount: doc.leagueCount ?? new Set(doc.projections.map((p) => p.leagueId)).size,
    };
  } catch {
    return null;
  }
}

export async function writePrizePicksCache(result: PrizePicksFetchResult): Promise<void> {
  const doc: PrizePicksCacheDoc = {
    fetchedAt: result.fetchedAt,
    projections: result.projections,
    leagueCount: result.leagueCount,
  };
  await s3().send(
    new PutObjectCommand({
      Bucket: config.dropflow.bucket,
      Key: CACHE_KEY,
      Body: JSON.stringify(doc),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
}
