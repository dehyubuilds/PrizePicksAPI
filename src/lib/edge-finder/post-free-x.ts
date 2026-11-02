import { postTextToX } from "@/lib/playlist-insights/x-text-post";
import { freePickXText } from "./reasoning";
import type { EdgeScanPick } from "./types";

export async function postEdgeFinderFreePickToX(params: {
  userId: string;
  pick: EdgeScanPick;
}): Promise<{ tweetUrl: string } | { error: string }> {
  const text = freePickXText(params.pick);
  const result = await postTextToX({ userId: params.userId, text });
  if ("error" in result) {
    return { error: result.error };
  }
  return { tweetUrl: result.tweetUrl };
}
