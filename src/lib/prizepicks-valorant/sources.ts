import type { SourceRecord } from "./types";
import { acceptHandle } from "./signals";

export const REGISTERED_PAGES: Array<Pick<SourceRecord, "name" | "url" | "sourceType" | "specialization">> = [
  { name: "VALORANT Esports", url: "https://valorantesports.com/", sourceType: "official", specialization: "Official match pages and announcements" },
  { name: "Riot Competitive Operations", url: "https://competitiveops.riotgames.com/en-US/VALORANT", sourceType: "official", specialization: "Competitive rulings and operations" },
  { name: "VLR.gg", url: "https://www.vlr.gg/", sourceType: "statistics", specialization: "Match pages and results" },
  { name: "VLR.gg stats", url: "https://www.vlr.gg/stats", sourceType: "statistics", specialization: "Player statistics pages" },
  { name: "RIB.gg", url: "https://rib.gg/", sourceType: "statistics", specialization: "Match and player statistics" },
  { name: "RIB.gg stats", url: "https://rib.gg/stats", sourceType: "statistics", specialization: "Player statistics pages" },
];

export function pageRecord(page: (typeof REGISTERED_PAGES)[number], probe: { status: number | null; error: string | null }, verifiedAt: string): SourceRecord {
  const reachable = probe.status != null && probe.status >= 200 && probe.status < 400;
  return {
    name: page.name,
    url: page.url,
    handle: null,
    sourceType: page.sourceType,
    specialization: page.specialization,
    verificationMethod: probe.error ? "request_failed" : `http_${probe.status}`,
    lastVerified: probe.status == null ? null : verifiedAt,
    reliability: probe.error ? "blocked" : reachable ? "page_reachable" : "blocked",
    apiAccess: "page_only",
    commercialUse: "unknown",
    notes: reachable
      ? "The page responded. No authorized map-level API was called, and the HTML was not stored as a dataset."
      : probe.error || `HTTP ${probe.status}. Map rows were not created.`,
  };
}

export function handleRecord(handle: string, url: string, verifiedAt: string): SourceRecord | null {
  const accepted = acceptHandle(handle, url);
  if (!accepted) return null;
  return {
    name: `@${accepted}`,
    url,
    handle: accepted,
    sourceType: "x_account",
    specialization: "Account returned with a post URL. Not treated as official unless the post is on a Riot domain.",
    verificationMethod: "post_url_host",
    lastVerified: verifiedAt,
    reliability: "unverified",
    apiAccess: "unknown",
    commercialUse: "unknown",
    notes: "The handle was kept because an X URL was returned. Impersonation was not otherwise checked.",
  };
}
