/** Polymarket market snapshot for Edge Finder matching. */
export type PolymarketPickSide = "yes" | "no";

export type PolymarketMarketSummary = {
  conditionId: string;
  slug: string;
  question: string;
  description: string;
  sportsMarketType: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: string;
  noPrice: string;
  volume: string;
  gameStartTime: string;
  endDate: string;
  sportTags: string[];
};

export type PolymarketGammaMarketRow = {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  sportsMarketType?: string;
  marketSportType?: string;
  sports_market_type?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  volume?: string;
  volumeNum?: number;
  gameStartTime?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  enableOrderBook?: boolean;
};

export type PolymarketClobPriceResponse = {
  price?: string;
};

export type PolymarketSportsRow = {
  id?: number;
  sport?: string;
  series?: string;
  tags?: string;
};
