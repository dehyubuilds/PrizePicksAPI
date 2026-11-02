import { prizepicksProxyList } from "./config";

let proxyIndex = 0;

/** Next proxy URL from PRIZEPICKS_PROXY_LIST (round-robin). */
export function nextPrizePicksProxyUrl(): string | null {
  const list = prizepicksProxyList();
  if (!list.length) return null;
  const proxy = list[proxyIndex]!;
  proxyIndex = (proxyIndex + 1) % list.length;
  return proxy;
}

export function prizepicksProxyConfigured(): boolean {
  return prizepicksProxyList().length > 0;
}

export function prizepicksProxyCount(): number {
  return prizepicksProxyList().length;
}
