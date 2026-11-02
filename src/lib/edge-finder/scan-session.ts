import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import type { KalshiMarketSummary } from "@/lib/kalshi/types";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";

const PREFIX = "admin/edge-finder/sessions";
const SESSION_TTL_MS = 60 * 60 * 1000;

export type EdgeFinderScanSession = {
  sessionId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  projections: PrizePicksProjection[];
  totalRawProjections: number;
  totalScannableProjections: number;
  prizepicksFromCache: boolean;
  sports: string[];
  markets?: KalshiMarketSummary[];
  kalshiMarketCount?: number;
};

function s3(): S3Client {
  return new S3Client(awsClientConfig());
}

function sessionKey(sessionId: string): string {
  return `${PREFIX}/${sessionId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`;
}

export function createEdgeFinderSessionId(): string {
  return `efs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function putEdgeFinderScanSession(session: EdgeFinderScanSession): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: config.dropflow.bucket,
      Key: sessionKey(session.sessionId),
      Body: JSON.stringify(session, null, 2),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
}

export async function getEdgeFinderScanSession(
  sessionId: string
): Promise<EdgeFinderScanSession | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({
        Bucket: config.dropflow.bucket,
        Key: sessionKey(sessionId),
      })
    );
    const raw = await res.Body?.transformToString();
    if (!raw) return null;
    const session = JSON.parse(raw) as EdgeFinderScanSession;
    const age = Date.now() - new Date(session.createdAt).getTime();
    if (!Number.isFinite(age) || age > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export async function loadEdgeFinderScanSession(params: {
  sessionId: string;
  userId: string;
}): Promise<EdgeFinderScanSession> {
  const session = await getEdgeFinderScanSession(params.sessionId);
  if (!session) {
    throw new Error("Scan session expired or not found. Run Scan markets again.");
  }
  if (session.userId !== params.userId) {
    throw new Error("Scan session does not belong to this admin user.");
  }
  return session;
}
