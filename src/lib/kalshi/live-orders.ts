import { randomUUID } from "crypto";
import { kalshiPost } from "./client";
import type { TwelveXLeg } from "../top-picks-cli/twelve-x-plan";

export type LiveOrderResult = {
  ticker: string;
  side: "yes" | "no";
  bookSide: "bid" | "ask";
  price: string;
  count: string;
  clientOrderId: string;
  orderId?: string;
  fillCount?: string;
  remainingCount?: string;
};

/**
 * Buy YES = bid at yes dollars.
 * Buy NO = ask (sell YES) at 1 - no dollars.
 */
export function bookForPickedSide(leg: TwelveXLeg): { bookSide: "bid" | "ask"; price: string } {
  if (leg.side === "yes") {
    return { bookSide: "bid", price: (leg.priceCents / 100).toFixed(4) };
  }
  return { bookSide: "ask", price: ((100 - leg.priceCents) / 100).toFixed(4) };
}

export function sizeEqualCashLegs(legs: TwelveXLeg[], cashDollars: number): Array<TwelveXLeg & { count: number }> {
  if (!legs.length || cashDollars <= 0) return [];
  const per = cashDollars / legs.length;
  return legs.map((leg) => {
    const px = leg.priceCents / 100;
    const count = px > 0 ? Math.floor((per + 1e-9) / px) : 0;
    return { ...leg, count };
  }).filter((leg) => leg.count > 0);
}

export async function placeLiveCryptoSingles(params: {
  legs: TwelveXLeg[];
  cashDollars: number;
}): Promise<LiveOrderResult[]> {
  const sized = sizeEqualCashLegs(params.legs, params.cashDollars);
  if (!sized.length) {
    throw new Error("No live sizes — need 15-min legs and cash > $0.");
  }
  const placed: LiveOrderResult[] = [];
  for (const leg of sized) {
    const { bookSide, price } = bookForPickedSide(leg);
    const clientOrderId = randomUUID();
    const count = leg.count.toFixed(2);
    const res = await kalshiPost<{
      order_id?: string;
      fill_count?: string;
      remaining_count?: string;
    }>("/portfolio/events/orders", {
      ticker: leg.ticker,
      client_order_id: clientOrderId,
      side: bookSide,
      count,
      price,
      time_in_force: "immediate_or_cancel",
      self_trade_prevention_type: "taker_at_cross",
    });
    placed.push({
      ticker: leg.ticker,
      side: leg.side,
      bookSide,
      price,
      count,
      clientOrderId,
      orderId: res.order_id,
      fillCount: res.fill_count,
      remainingCount: res.remaining_count,
    });
  }
  return placed;
}
