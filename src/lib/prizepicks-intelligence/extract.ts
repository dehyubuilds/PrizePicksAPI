import { eventKeyForMarket } from "./cluster";
import type {
  EventCluster,
  GrokChange,
  GrokEventPacket,
  NormalizedMarket,
  RejectedThesis,
  SignalType,
} from "./types";

const SIGNAL_TYPES = new Set<SignalType>([
  "ROLE_CHANGE",
  "LINEUP",
  "INJURY",
  "USAGE",
  "MATCHUP",
  "ENVIRONMENT",
  "WORKLOAD",
  "TACTICAL",
]);

export function normalizeSignalType(raw?: string): SignalType {
  const value = String(raw ?? "ROLE_CHANGE").trim().toUpperCase().replace(/\s+/g, "_");
  return SIGNAL_TYPES.has(value as SignalType) ? (value as SignalType) : "ROLE_CHANGE";
}

function playerKey(value: string): string {
  return value.trim().toLowerCase();
}

export function matchMarkets(cluster: EventCluster, change: GrokChange): NormalizedMarket[] {
  const player = playerKey(change.player ?? "");
  const stat = (change.statType ?? "").trim().toLowerCase();
  const hits = cluster.markets.filter((market) => {
    if (player && playerKey(market.player) !== player) return false;
    if (stat && !market.statType.toLowerCase().includes(stat) && !stat.includes(market.statType.toLowerCase())) {
      return false;
    }
    return true;
  });
  if (hits.length) return hits;
  if (player) return [];
  return cluster.markets.slice(0, 1);
}

export function clusterByKey(clusters: EventCluster[]): Map<string, EventCluster> {
  return new Map(clusters.map((cluster) => [cluster.eventKey, cluster]));
}

export function flattenPackets(packets: GrokEventPacket[]): Array<GrokChange & { bucket: "change" | "watch" | "rejected" }> {
  const rows: Array<GrokChange & { bucket: "change" | "watch" | "rejected" }> = [];
  for (const packet of packets) {
    for (const change of packet.changes ?? []) {
      rows.push({ ...change, eventKey: change.eventKey || packet.eventKey, bucket: "change" });
    }
    for (const change of packet.watch ?? []) {
      rows.push({ ...change, eventKey: change.eventKey || packet.eventKey, bucket: "watch" });
    }
    for (const change of packet.rejected ?? []) {
      rows.push({ ...change, eventKey: change.eventKey || packet.eventKey, bucket: "rejected" });
    }
  }
  return rows;
}

export function rejectedFromChange(change: GrokChange, market?: NormalizedMarket): RejectedThesis {
  return {
    player: change.player || market?.player || "unknown",
    market: market ? `${market.player} ${market.projection} ${market.statType}` : change.statType || change.eventKey,
    initialHypothesis: change.whatChanged || change.whyNow || "unspecified",
    whyRejected: change.rejectReason || "Did not survive validation.",
    evidenceReviewed: (change.sources ?? []).map((source) => source.url || source.outlet).join("; ") || "none",
  };
}

export { eventKeyForMarket };
