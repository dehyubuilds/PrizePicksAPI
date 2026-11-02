import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import http from "node:http";
import https from "node:https";
// https-proxy-agent@5 is CJS; under Node ESM the constructor is the default export.
import HttpsProxyAgent from "https-proxy-agent";

type HttpGetResult = {
  status: number;
  body: string;
};

function decodeResponseBody(buffer: Buffer, contentEncoding: string | undefined): string {
  const enc = (contentEncoding ?? "").toLowerCase();
  if (enc.includes("gzip")) {
    return gunzipSync(buffer).toString("utf8");
  }
  if (enc.includes("deflate")) {
    return inflateSync(buffer).toString("utf8");
  }
  if (enc.includes("br")) {
    return brotliDecompressSync(buffer).toString("utf8");
  }
  return buffer.toString("utf8");
}

/** Node HTTPS GET with optional HTTP(S) proxy (for PrizePicks Cloudflare bypass). */
export function httpGetText(
  url: string,
  headers: Record<string, string>,
  proxyUrl?: string | null
): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const agent = proxyUrl
      ? (new HttpsProxyAgent(proxyUrl) as unknown as https.Agent)
      : undefined;

    const req = lib.get(
      url,
      {
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const body = decodeResponseBody(raw, res.headers["content-encoding"]);
          resolve({
            status: res.statusCode ?? 0,
            body,
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("PrizePicks request timed out after 30s"));
    });
  });
}
