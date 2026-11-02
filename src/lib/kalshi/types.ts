/** Kalshi market snapshot attached to Dropflow picks (v1). */
export type KalshiPickSide = "yes" | "no";

export type KalshiPickData = {
  available: boolean;
  ticker?: string;
  marketTitle?: string;
  pickedSide?: KalshiPickSide | null;
  currentPrice?: string;
  impliedProbability?: number;
  volume?: string;
  closeTime?: string;
  settlementRules?: string;
  marketUrl?: string;
};

/** Compact market row fed into GPT corpus. */
export type KalshiMarketSummary = {
  ticker: string;
  eventTicker: string;
  title: string;
  yesSubTitle: string;
  noSubTitle: string;
  yesBidDollars: string;
  yesAskDollars: string;
  volumeFp: string;
  closeTime: string;
  rulesPrimary: string;
  sportTags: string[];
};

export type KalshiMarketsApiResponse = {
  markets?: KalshiMarketApiRow[];
  cursor?: string | null;
};

export type KalshiEventsApiResponse = {
  events?: Array<{
    event_ticker?: string;
    series_ticker?: string;
    title?: string;
    category?: string;
    status?: string;
    close_time?: string;
  }>;
  cursor?: string | null;
};

export type KalshiMarketApiRow = {
  ticker?: string;
  event_ticker?: string;
  series_ticker?: string;
  category?: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  close_time?: string;
  rules_primary?: string;
  status?: string;
};
