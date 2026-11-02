import { config } from "@/lib/config";

/**
 * Local WebSocket bridge for YouTube → Dropflow track import.
 * Netlify: set `DROPFLOW_YOUTUBE_IMPORT_*` to match your worker + API Gateway stack.
 */
export function youtubeImportLocalWebSocketModeResolved(): boolean {
  const env = process.env.DROPFLOW_YOUTUBE_IMPORT_LOCAL_WEBSOCKET_MODE?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off") return false;
  if (env === "1" || env === "true" || env === "on") return true;
  return Boolean(config.youtubeImport.localWebSocketMode);
}

export function youtubeImportLocalWsJobsTableResolved(): string {
  const fromEnv = process.env.DROPFLOW_YOUTUBE_IMPORT_LOCAL_WS_JOBS_TABLE?.trim();
  if (fromEnv) return fromEnv;
  return String(config.youtubeImport.localWsJobsTable ?? "").trim();
}

export function youtubeImportLocalWebSocketUrlResolved(): string {
  const fromEnv = process.env.DROPFLOW_YOUTUBE_IMPORT_LOCAL_WEBSOCKET_URL?.trim();
  if (fromEnv) return fromEnv;
  return String(config.youtubeImport.localWebSocketUrl ?? "").trim();
}

export function useYoutubeImportLocalWebSocketResolved(): boolean {
  return Boolean(
    youtubeImportLocalWebSocketModeResolved() &&
      youtubeImportLocalWsJobsTableResolved() &&
      youtubeImportLocalWebSocketUrlResolved()
  );
}
