import { fetchOdds, oddsApiKey, parseEvents } from "@/lib/prizepicks-odds/client";
import { alternateMarket, sportKeyForLeague } from "@/lib/prizepicks-odds/markets";
import { marketPriority, NEWS_SPORTS } from "./scope";

export async function diagnoseOdds(options: { maxOddsCredits?: number; fetchImpl?: typeof fetchOdds } = {}): Promise<string> {
  const lines: string[] = [];
  lines.push(`Odds API key present: ${oddsApiKey() ? "yes" : "no"}`);
  if (!oddsApiKey()) {
    lines.push("Status: ODDS_AUTH_FAILED. Set THE_ODDS_API_KEY. No request was sent.");
    return lines.join("\n");
  }
  const fetchImpl = options.fetchImpl ?? fetchOdds;
  try {
    const sports = await fetchImpl("/sports", "news_sports_list");
    const rows = Array.isArray(sports.json) ? sports.json : [];
    const keys = new Set(rows.map((row) => (row && typeof row === "object" ? String((row as { key?: string }).key ?? "") : "")).filter(Boolean));
    lines.push(`Provider status: sports list ok. Cache hit: ${sports.fromCache ? "yes" : "no"}.`);
    lines.push(`Remaining credits: ${sports.remaining == null ? "not exposed" : sports.remaining}. Last cost: ${sports.lastCost ?? 0}.`);
    for (const sport of NEWS_SPORTS) {
      const key = sportKeyForLeague(sport);
      const listed = key ? keys.has(key) : false;
      lines.push(`${sport} -> ${key ?? "unmapped"}: ${listed ? "listed by the provider" : "not in the sports list"}.`);
      const markets = marketPriority(sport);
      const alts = markets.map((market) => `${market}${alternateMarket(sport, market) ? ` (alternate ${alternateMarket(sport, market)})` : " (no documented alternate)"}`);
      lines.push(`  Markets: ${alts.join(", ")}`);
    }
    lines.push("The free sports list does not prove that player-prop markets are priced.");
    const budget = options.maxOddsCredits ?? 0;
    if (budget < 1) {
      lines.push("Event probe skipped. Pass --max-odds-credits 1 to spend about 1 credit listing MLB events.");
      return lines.join("\n");
    }
    const events = await fetchImpl("/sports/baseball_mlb/events", "news_check_mlb_events");
    const parsed = parseEvents(events.json);
    lines.push(`MLB events probe: ${parsed.length} games. Cache hit: ${events.fromCache ? "yes" : "no"}. Cost: ${events.fromCache ? 0 : events.lastCost ?? 1}. Remaining: ${events.remaining ?? "not exposed"}.`);
    if (!parsed.length) lines.push("Event not available: the MLB events list was empty.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = /401|403/.test(message) ? "ODDS_AUTH_FAILED" : /timeout|aborted/i.test(message) ? "ODDS_TIMEOUT" : "ODDS_PROVIDER_ERROR";
    lines.push(`Status: ${code}. ${message}`);
  }
  return lines.join("\n");
}
