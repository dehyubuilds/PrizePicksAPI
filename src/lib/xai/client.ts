export type GrokResponsesApi = {
  status?: string;
  error?: { message?: string } | string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export function grokApiKey(): string {
  return (
    process.env.XAI_API_KEY?.trim() ||
    process.env.GROK_API_KEY?.trim() ||
    process.env.DROPFLOW_XAI_API_KEY?.trim() ||
    ""
  );
}

export function grokConfigured(): boolean {
  return Boolean(grokApiKey());
}

export function isGrokTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("abort") || /timeout/i.test(message);
}

export function grokModel(): string {
  return process.env.GROK_MODEL?.trim() || "grok-4.7";
}

export function extractResponsesText(data: GrokResponsesApi): string {
  const chunks: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.text?.trim()) chunks.push(part.text.trim());
    }
  }
  return chunks.join("\n").trim();
}

export function parseJsonObject<T = Record<string, unknown>>(content: string): T {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Grok returned invalid JSON.");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export type CallGrokResponsesParams = {
  instructions: string;
  input: string;
  temperature?: number;
  tools?: Array<{ type: string }>;
  timeoutMs?: number;
  /** Assistant turns in the agent loop. One turn can call several tools. */
  maxTurns?: number;
};

export type GrokToolUsage = {
  webSearchCalls: number | null;
  xSearchCalls: number | null;
  xPostsFetched: number | null;
};

export async function callGrokResponses(params: CallGrokResponsesParams): Promise<{
  model: string;
  text: string;
  parsed: Record<string, unknown>;
  toolUsage: GrokToolUsage;
}> {
  const key = grokApiKey();
  if (!key) {
    throw new Error("Set XAI_API_KEY or GROK_API_KEY in .env.local (https://console.x.ai).");
  }

  const model = grokModel();
  const timeoutMs = params.timeoutMs ?? 90_000;
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      tools: params.tools ?? [{ type: "web_search" }, { type: "x_search" }],
      instructions: params.instructions,
      input: [{ role: "user", content: params.input }],
      ...(params.maxTurns ? { max_turns: params.maxTurns } : {}),
    }),
  });

  const data = (await res.json().catch(() => ({}))) as GrokResponsesApi;
  const apiError =
    typeof data.error === "string"
      ? data.error
      : data.error && typeof data.error === "object"
        ? data.error.message
        : "";
  if (!res.ok) {
    throw new Error(`Grok API failed (${res.status})${apiError ? `: ${apiError}` : ""}`);
  }

  const text = extractResponsesText(data);
  if (!text) throw new Error("Grok returned an empty response.");
  return { model, text, parsed: parseJsonObject(text), toolUsage: readToolUsage(data) };
}

function readToolUsage(data: GrokResponsesApi): GrokToolUsage {
  const row = data as GrokResponsesApi & {
    server_side_tool_usage?: Record<string, number>;
    usage?: { server_side_tool_usage_details?: { x_posts_fetched?: number } };
  };
  const usage = row.server_side_tool_usage;
  if (!usage) return { webSearchCalls: null, xSearchCalls: null, xPostsFetched: null };
  return {
    webSearchCalls: Number(usage.SERVER_SIDE_TOOL_WEB_SEARCH ?? 0),
    xSearchCalls: Number(usage.SERVER_SIDE_TOOL_X_SEARCH ?? 0),
    xPostsFetched: row.usage?.server_side_tool_usage_details?.x_posts_fetched ?? null,
  };
}
