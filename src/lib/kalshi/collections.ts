import { kalshiGet } from "./client";

export type MultivariateCollection = {
  ticker: string;
  title?: string;
};

export async function listMultivariateCollections(): Promise<MultivariateCollection[]> {
  const data = await kalshiGet<{
    multivariate_event_collections?: Array<{ ticker?: string; title?: string }>;
    collections?: Array<{ ticker?: string; title?: string }>;
  }>("/multivariate_event_collections?limit=50");
  const rows = data.multivariate_event_collections ?? data.collections ?? [];
  return rows
    .map((row) => ({ ticker: (row.ticker ?? "").trim(), title: row.title }))
    .filter((row) => row.ticker);
}

export function pickCollectionForLegs(params: {
  collections: MultivariateCollection[];
  defaultTicker: string;
  allCrypto15m: boolean;
}): { ticker: string; verified: boolean; reason: string } {
  if (params.allCrypto15m) {
    const hit = params.collections.find((c) => c.ticker === params.defaultTicker);
    return {
      ticker: params.defaultTicker,
      verified: Boolean(hit) || params.collections.length === 0,
      reason: hit ? "default crypto/cross collection listed" : "default collection (list empty or missing)",
    };
  }
  const cross = params.collections.find((c) => /cross/i.test(`${c.ticker} ${c.title ?? ""}`)) ?? params.collections[0];
  if (!cross) {
    return { ticker: params.defaultTicker, verified: false, reason: "COMBO_INCOMPATIBLE — no listed collection" };
  }
  return { ticker: cross.ticker, verified: true, reason: `using listed collection ${cross.ticker}` };
}
