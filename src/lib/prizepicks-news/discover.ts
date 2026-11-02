import { createHash } from "crypto";
import { hostTier } from "@/lib/prizepicks-odds/evidence";
import { normalizePlayerName } from "@/lib/prizepicks-odds/markets";
import { SOURCE_HANDLES, type NewsSport } from "./scope";
import type { EvidenceStatus, NewsEvent, NewsEventType, NewsSource, SlateGame } from "./types";

const EVENT_TYPES = new Set<NewsEventType>([
  "injury",
  "absence",
  "lineup_change",
  "role_change",
  "workload_limit",
  "coach_comment",
  "weather",
  "other",
]);

const ROLE_TYPES = new Set<NewsEventType>(["role_change", "workload_limit"]);

export function discoveryTasks(sport: NewsSport): Array<{ id: string; focus: string }> {
  if (sport === "NFL") {
    return [
      { id: "injuries", focus: "Only injuries, inactives, and questionable tags for these games." },
      { id: "roles", focus: "Only offensive role, target, snap, and backfield changes." },
      { id: "starters", focus: "Only depth-chart and starter changes." },
      { id: "weather", focus: "Only weather that could change passing or rushing volume." },
    ];
  }
  if (sport === "MLB") {
    return [{ id: "pitchers", focus: "Only starting-pitcher workload, pitch counts, and strikeout news. Ignore hitters." }];
  }
  if (sport === "SOCCER") {
    return [{ id: "availability", focus: "Only injuries, absences, and lineup changes. Ignore goals, shots, and assists markets that are not a lineup change." }];
  }
  return [{ id: "availability", focus: "Only injuries, lineup changes, and minutes or rebounding roles." }];
}

export function discoveryInput(sport: NewsSport, games: SlateGame[], taskFocus?: string): string {
  const slate = games
    .slice(0, 8)
    .map((game) => `${game.team} vs ${game.opponent} starts ${game.startTime}`)
    .join("\n");
  const focus =
    taskFocus ??
    (sport === "MLB"
      ? "Pitcher strikeouts only. Ignore hitter props."
      : sport === "WNBA"
        ? "Availability, minutes, and rebounding or usage roles."
        : "Injuries, inactives, targets, and snap changes. Prioritize receptions.");
  return [
    `Sport: ${sport}`,
    `Search hints: ${SOURCE_HANDLES[sport].join(", ")}`,
    focus,
    "Upcoming games:",
    slate || "none",
    "Return only developments that can change a player's opportunities. Skip completed games and gambling picks.",
  ].join("\n");
}

export const DISCOVERY_INSTRUCTIONS = `You search public web and X sources for sports news. Return strict JSON:
{"events":[{"eventType":"injury|absence|lineup_change|role_change|workload_limit|coach_comment|weather|other","summary":"","players":[""],"teams":[""],"direction":"up|down|unclear","sources":[{"url":"https://","author":"","publishedAt":""}]}]}
Rules: every source url must be a real page you found. Do not invent URLs or timestamps. Use an empty publishedAt when the time is unknown. One development is one event even if many accounts repost it. If sources disagree, return both and set direction to unclear. Empty events is correct when nothing material is new.`;

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function classifySources(sources: NewsSource[], directions: string[]): EvidenceStatus {
  const urls = sources.filter((source) => httpUrl(source.url));
  const uniqueDirections = new Set(directions.filter((direction) => direction === "up" || direction === "down"));
  if (uniqueDirections.size > 1) return "contradicted";
  if (!urls.length) return "unverified";
  if (urls.some((source) => hostTier(source.url) === 1)) return "official";
  const hosts = new Set<string>();
  let reporting = 0;
  for (const source of urls) {
    if (hostTier(source.url) !== 3) continue;
    reporting += 1;
    hosts.add(new URL(source.url).hostname);
  }
  if (reporting >= 2 && hosts.size >= 2) return "corroborated";
  if (reporting >= 1) return "reported";
  return "unverified";
}

function eventId(sport: NewsSport, eventType: NewsEventType, players: string[]): string {
  return createHash("sha1").update(`${sport}|${eventType}|${players.join(",")}`).digest("hex").slice(0, 12);
}

function asDirection(value: unknown): "up" | "down" | "unclear" {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "up" || raw === "down") return raw;
  return "unclear";
}

export function parseDiscoveredEvents(payload: unknown, sport: NewsSport, discoveredAt: string): NewsEvent[] {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { events?: unknown }).events)
    ? (payload as { events: unknown[] }).events
    : [];
  const drafts: Array<{ event: Omit<NewsEvent, "id" | "evidenceStatus">; direction: "up" | "down" | "unclear" }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const claimed = String(raw.sport ?? sport).trim().toUpperCase();
    if (claimed && claimed !== sport) continue;
    const eventType = EVENT_TYPES.has(String(raw.eventType) as NewsEventType) ? (String(raw.eventType) as NewsEventType) : "other";
    const players = (Array.isArray(raw.players) ? raw.players : [])
      .map((player) => String(player).trim())
      .filter(Boolean);
    const summary = String(raw.summary ?? "").trim();
    if (!summary || !players.length) continue;
    const sources: NewsSource[] = [];
    for (const source of Array.isArray(raw.sources) ? raw.sources : []) {
      if (!source || typeof source !== "object") continue;
      const item = source as Record<string, unknown>;
      const url = httpUrl(String(item.url ?? ""));
      if (!url) continue;
      const published = String(item.publishedAt ?? "").trim();
      sources.push({
        url,
        author: String(item.author ?? "").trim(),
        publishedAt: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null,
      });
    }
    drafts.push({
      direction: asDirection(raw.direction),
      event: {
        sport,
        teamIds: (Array.isArray(raw.teams) ? raw.teams : []).map((team) => String(team).trim()).filter(Boolean),
        playerIds: players,
        eventType,
        summary,
        direction: asDirection(raw.direction),
        sources,
        sourceUrls: sources.map((source) => source.url),
        publishedAt: sources.find((source) => source.publishedAt)?.publishedAt ?? null,
        discoveredAt,
        roleChange: ROLE_TYPES.has(eventType),
      },
    });
  }
  return dedupeNewsEvents(drafts, discoveredAt);
}

export function dedupeNewsEvents(
  drafts: Array<{ event: Omit<NewsEvent, "id" | "evidenceStatus">; direction: "up" | "down" | "unclear" }>,
  discoveredAt: string
): NewsEvent[] {
  const groups = new Map<string, typeof drafts>();
  for (const draft of drafts) {
    const players = Array.from(new Set(draft.event.playerIds.map((player) => normalizePlayerName(player)).filter(Boolean))).sort();
    const key = `${draft.event.sport}|${draft.event.eventType}|${players.join(",")}`;
    const list = groups.get(key) ?? [];
    list.push(draft);
    groups.set(key, list);
  }
  const events: NewsEvent[] = [];
  for (const group of Array.from(groups.values())) {
    const first = group[0]!.event;
    const sources = group.flatMap((draft) => draft.event.sources);
    const unique = new Map<string, NewsSource>();
    for (const source of sources) unique.set(source.url, source);
    const mergedSources = Array.from(unique.values());
    const directions = group.map((draft) => draft.direction);
    const players = Array.from(new Set(group.flatMap((draft) => draft.event.playerIds)));
    const playerKeys = Array.from(new Set(players.map((player) => normalizePlayerName(player)).filter(Boolean))).sort();
    const status = classifySources(mergedSources, directions);
    events.push({
      ...first,
      id: eventId(first.sport, first.eventType, playerKeys),
      playerIds: players,
      summary: group.map((draft) => draft.event.summary).filter((summary, index, all) => all.indexOf(summary) === index).join(" "),
      direction: status === "contradicted" ? "unclear" : first.direction,
      sources: mergedSources,
      sourceUrls: mergedSources.map((source) => source.url),
      publishedAt: mergedSources.find((source) => source.publishedAt)?.publishedAt ?? null,
      discoveredAt,
      evidenceStatus: status,
      roleChange: first.roleChange,
    });
  }
  return events;
}
