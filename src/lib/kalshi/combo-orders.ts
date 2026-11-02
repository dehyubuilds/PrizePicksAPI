import { randomUUID } from "crypto";
import { kalshiGet, kalshiPost } from "./client";
import {
  COMBO_COLLECTION_TICKER,
  COMBO_EXCHANGE_INDEX,
  type FavoriteLeg,
} from "../top-picks-cli/crypto-favorites";

export type CreatedComboMarket = {
  eventTicker: string;
  marketTicker: string;
  yesAsk: number | null;
  yesBid: number | null;
  exchangeIndex: number;
  title?: string;
};

function parseDollars(raw: string | undefined): number | null {
  const n = Number.parseFloat(raw ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchKalshiMarketSnapshot(ticker: string): Promise<CreatedComboMarket> {
  const data = await kalshiGet<{
    market?: {
      ticker?: string;
      event_ticker?: string;
      title?: string;
      yes_ask_dollars?: string;
      yes_bid_dollars?: string;
      exchange_index?: number;
    };
    ticker?: string;
    event_ticker?: string;
    title?: string;
    yes_ask_dollars?: string;
    yes_bid_dollars?: string;
    exchange_index?: number;
  }>(`/markets/${encodeURIComponent(ticker)}`);
  const m = data.market ?? data;
  return {
    eventTicker: (m.event_ticker ?? "").trim(),
    marketTicker: (m.ticker ?? ticker).trim(),
    yesAsk: parseDollars(m.yes_ask_dollars),
    yesBid: parseDollars(m.yes_bid_dollars),
    exchangeIndex: Number(m.exchange_index) || COMBO_EXCHANGE_INDEX,
    title: m.title,
  };
}

export async function createFavoriteComboMarket(
  legs: FavoriteLeg[],
  collectionTicker = COMBO_COLLECTION_TICKER
): Promise<CreatedComboMarket> {
  if (legs.length < 2) throw new Error("Combo needs at least 2 legs.");
  const collection = collectionTicker.trim() || COMBO_COLLECTION_TICKER;
  const res = await kalshiPost<{
    event_ticker?: string;
    market_ticker?: string;
    market?: {
      ticker?: string;
      event_ticker?: string;
      title?: string;
      yes_ask_dollars?: string;
      yes_bid_dollars?: string;
      exchange_index?: number;
    };
  }>(`/multivariate_event_collections/${collection}`, {
    selected_markets: legs.map((leg) => ({
      market_ticker: leg.ticker,
      event_ticker: leg.eventTicker,
      side: leg.side,
    })),
    with_market_payload: true,
  });
  const ticker = (res.market_ticker || res.market?.ticker || "").trim();
  if (!ticker) throw new Error("Kalshi created a combo without a market ticker.");
  try {
    return await fetchKalshiMarketSnapshot(ticker);
  } catch {
    return {
      eventTicker: (res.event_ticker || res.market?.event_ticker || "").trim(),
      marketTicker: ticker,
      yesAsk: parseDollars(res.market?.yes_ask_dollars),
      yesBid: parseDollars(res.market?.yes_bid_dollars),
      exchangeIndex: Number(res.market?.exchange_index) || COMBO_EXCHANGE_INDEX,
      title: res.market?.title,
    };
  }
}

export type ComboOrderResult = {
  ticker: string;
  price: string;
  count: string;
  clientOrderId: string;
  orderId?: string;
  fillCount?: string;
  remainingCount?: string;
};

export async function buyComboYesIoc(params: {
  ticker: string;
  price: number;
  contracts: number;
  exchangeIndex?: number;
  clientOrderId?: string;
}): Promise<ComboOrderResult> {
  if (!(params.price > 0) || params.price >= 1) {
    throw new Error("Combo ask is not tradable.");
  }
  if (params.contracts < 1) throw new Error("Need at least 1 combo contract.");
  const clientOrderId = params.clientOrderId?.trim() || randomUUID();
  const price = params.price.toFixed(4);
  const count = params.contracts.toFixed(2);
  const res = await kalshiPost<{
    order_id?: string;
    fill_count?: string;
    remaining_count?: string;
  }>("/portfolio/events/orders", {
    ticker: params.ticker,
    client_order_id: clientOrderId,
    side: "bid",
    count,
    price,
    time_in_force: "immediate_or_cancel",
    self_trade_prevention_type: "taker_at_cross",
    exchange_index: params.exchangeIndex ?? COMBO_EXCHANGE_INDEX,
  });
  return {
    ticker: params.ticker,
    price,
    count,
    clientOrderId,
    orderId: res.order_id,
    fillCount: res.fill_count,
    remainingCount: res.remaining_count,
  };
}
