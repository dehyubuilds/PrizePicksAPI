import { getFreshXAccessToken, X_TWEETS_URL } from "@/lib/dropflow-x-oauth";

/** X counts any URL as 23 chars; keep text within budget so text + space + URL fits in 280. */
const X_MAX_CHARS = 280;
const X_URL_WEIGHT = 23;

export type XTextPostResult =
  | { tweetId: string; tweetUrl: string }
  | { error: string; code: "not_connected" | "reconnect_required" | "x_tweet_create_failed" };

function formatRateLimitReset(raw: string | null): string | null {
  if (!raw) return null;
  const resetMs = Number(raw) * 1000;
  if (!Number.isFinite(resetMs) || resetMs <= 0) return null;
  const resetAt = new Date(resetMs);
  if (resetAt.getTime() <= Date.now()) return null;
  return resetAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function describeXPostFailure(params: {
  status: number;
  detail: string;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
}): string {
  const { status, detail, rateLimitRemaining, rateLimitReset } = params;
  const resetLabel = formatRateLimitReset(rateLimitReset);
  const remaining = rateLimitRemaining !== null ? Number(rateLimitRemaining) : NaN;

  if (status === 429) {
    if (/spend|cap|billing|credit|quota|usage.*exceed/i.test(detail)) {
      return `X blocked the post because your developer spend cap or credits were exhausted. Raise Manage Spend Cap in X Developer billing, then retry.${resetLabel ? ` Limit may reset around ${resetLabel}.` : ""}`;
    }
    if (Number.isFinite(remaining) && remaining <= 0) {
      return `X posting rate limit hit (${remaining} requests left in this window). This is separate from your spend cap — wait for the window to reset${resetLabel ? ` around ${resetLabel}` : " in about 15 minutes"}, then click Post to X once.`;
    }
    return `X posting rate limit hit. Your spend cap can be fine and you may still see this after several post attempts. Wait${resetLabel ? ` until about ${resetLabel}` : " 15–60 minutes"}, then click Post to X once.${detail ? ` (${detail.slice(0, 120)})` : ""}`;
  }

  return `Could not post to X: ${detail}`;
}

/**
 * Post a text-only tweet (no media) from the given user's connected X account.
 * The url is appended after the text and weighted at 23 chars.
 */
export async function postTextToX(params: {
  userId: string;
  text: string;
  url?: string;
}): Promise<XTextPostResult> {
  const tokenResult = await getFreshXAccessToken(params.userId);
  if ("error" in tokenResult) {
    return {
      error:
        tokenResult.error === "not_connected"
          ? "Connect your X account in Settings first."
          : "Your X connection expired. Reconnect in Settings.",
      code: tokenResult.error,
    };
  }

  const urlPart = params.url?.trim() ?? "";
  const budget = urlPart ? X_MAX_CHARS - X_URL_WEIGHT - 1 : X_MAX_CHARS;
  let text = params.text.trim();
  if (text.length > budget) text = `${text.slice(0, budget - 1).trimEnd()}…`;
  const fullText = urlPart ? `${text} ${urlPart}` : text;

  const res = await fetch(X_TWEETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: fullText }),
  });
  const responseText = await res.text().catch(() => "");
  const data = (() => {
    try {
      return responseText ? JSON.parse(responseText) : {};
    } catch {
      return {};
    }
  })() as {
    data?: { id?: string };
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string; detail?: string; title?: string }>;
  };
  if (!res.ok || !data.data?.id) {
    const errorDetails = Array.isArray(data.errors)
      ? data.errors
          .map((err) => err.message || err.detail || err.title || "")
          .filter(Boolean)
          .join("; ")
      : "";
    const detail =
      data.detail || data.title || errorDetails || responseText.slice(0, 240) || `X returned ${res.status}`;
    return {
      error: describeXPostFailure({
        status: res.status,
        detail,
        rateLimitRemaining: res.headers.get("x-rate-limit-remaining"),
        rateLimitReset: res.headers.get("x-rate-limit-reset"),
      }),
      code: "x_tweet_create_failed",
    };
  }
  const tweetId = data.data.id;
  return {
    tweetId,
    tweetUrl: `https://x.com/${tokenResult.xUsername || "i"}/status/${tweetId}`,
  };
}
