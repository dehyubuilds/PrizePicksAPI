import type { CategoryRecord, DataSourceRecord, SourceStatus } from "./types";

export function boardSource(categories: CategoryRecord[], fetchedAt: string | null): DataSourceRecord {
  return {
    provider: "PrizePicks board",
    url: "https://api.prizepicks.com/projections",
    categories: categories.map((category) => category.categoryId),
    statCoverage: "Live thresholds and prop labels on the board loaded for this audit.",
    historicalDepth: null,
    updateFrequency: fetchedAt ? `Board timestamp ${fetchedAt}` : null,
    apiAvailable: "yes",
    access: "unknown",
    price: null,
    commercialUse: "unknown",
    reliability: "tested",
    machineReadable: "yes",
    status: "VERIFIED_ACCESS",
    tested: true,
    notes: "This process loaded the board. That verifies current listings, not a historical database.",
  };
}

export function oddsCatalogSource(categoryIds: string[]): DataSourceRecord {
  return {
    provider: "The Odds API",
    url: "https://api.the-odds-api.com/v4/sports",
    categories: categoryIds,
    statCoverage: "Sport catalog and, when requested, event odds for documented full-game markets.",
    historicalDepth: null,
    updateFrequency: "Request time. Responses are cached for 12 hours in tmp/prizepicks-odds/cache.",
    apiAvailable: "yes",
    access: "paid",
    price: null,
    commercialUse: "restricted",
    reliability: "tested",
    machineReadable: "yes",
    status: "VERIFIED_ACCESS",
    tested: true,
    notes: "The sport list call was completed. Vendor list price is not recorded here because this run did not read a public price page.",
  };
}

export type GrokSourceDraft = {
  provider?: string;
  url?: string;
  categories?: string[];
  statCoverage?: string;
  historicalDepth?: string | null;
  updateFrequency?: string | null;
  apiAvailable?: string;
  access?: string;
  price?: string | number | null;
  commercialUse?: string;
  notes?: string;
};

/** Grok is a discovery aid. A source it names stays untested unless this process called it. */
export function sourcesFromGrok(payload: unknown, allowedCategoryIds: Map<string, string>): DataSourceRecord[] {
  const rows = payload && typeof payload === "object" && Array.isArray((payload as { sources?: unknown }).sources)
    ? ((payload as { sources: GrokSourceDraft[] }).sources)
    : [];
  return rows.flatMap((row) => {
    const provider = String(row.provider ?? "").trim();
    if (!provider) return [];
    const names = Array.isArray(row.categories) ? row.categories.map((name) => String(name)) : [];
    const ids = names.flatMap((name) => {
      const id = allowedCategoryIds.get(name.trim().toLowerCase());
      return id ? [id] : [];
    });
    const access = row.access === "paid" ? "paid" : row.access === "free" ? "free" : "unknown";
    const status: SourceStatus = access === "paid" ? "REQUIRES_SUBSCRIPTION" : "DOCUMENTED_BUT_UNTESTED";
    const price = row.price == null || row.price === "" ? null : String(row.price);
    return [
      {
        provider,
        url: row.url?.trim() || null,
        categories: ids,
        statCoverage: String(row.statCoverage ?? ""),
        historicalDepth: row.historicalDepth ? String(row.historicalDepth) : null,
        updateFrequency: row.updateFrequency ? String(row.updateFrequency) : null,
        apiAvailable: row.apiAvailable === "yes" || row.apiAvailable === "no" ? row.apiAvailable : "unknown",
        access,
        price,
        commercialUse: "unknown",
        reliability: "untested",
        machineReadable: "unknown",
        status,
        tested: false,
        notes: row.notes?.trim() || "Named by Grok. This audit did not call the provider.",
      },
    ];
  });
}
