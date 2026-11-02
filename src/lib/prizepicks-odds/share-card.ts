import sharp from "sharp";
import type { DailyPick } from "./best-picks";
import type { OddsLeg } from "./select";

const OG_W = 1200;
const OG_H = 630;

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export async function renderOddsShareCard(params: {
  legs: OddsLeg[];
  dateLabel: string;
}): Promise<Buffer> {
  const shown = params.legs.slice(0, 5);
  const rows = shown
    .map((leg, i) => {
      const y = 268 + i * 62;
      const line = truncateText(`${leg.sport}  ${leg.bookLine}`, 42);
      const edge =
        leg.gapKind === "line" && leg.bookPoint != null
          ? `off ${Math.round(Math.abs(leg.line - leg.bookPoint) * 10) / 10}`
          : `+${leg.edge}`;
      return `<g>
        <text x="80" y="${y}" fill="#fbbf24" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${i + 1}</text>
        <text x="124" y="${y}" fill="#ffffff" font-size="28" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(line)}</text>
        <text x="1080" y="${y}" text-anchor="end" fill="#86efac" font-size="26" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(edge)}</text>
      </g>`;
    })
    .join("\n");
  const extra = params.legs.length > shown.length ? params.legs.length - shown.length : 0;
  const title = params.legs.length ? "Sportsbook board" : "No legs cleared";
  const svg = `<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#101218"/>
        <stop offset="55%" stop-color="#07080c"/>
        <stop offset="100%" stop-color="#05060a"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.15" cy="0.1" r="0.9">
        <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
    <ellipse cx="160" cy="80" rx="280" ry="200" fill="url(#glow)"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="${OG_H - 80}" rx="28" fill="rgba(255,255,255,0.03)" stroke="rgba(251,191,36,0.28)" stroke-width="2"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="6" rx="3" fill="#fbbf24"/>
    <text x="80" y="118" fill="#ffffff" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">Drop</text>
    <text x="154" y="118" fill="#fbbf24" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">flow</text>
    <rect x="280" y="88" width="250" height="38" rx="19" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.45)"/>
    <text x="405" y="114" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="800" letter-spacing="0.12em" font-family="Inter, Arial, Helvetica, sans-serif">ODDS API</text>
    <text x="80" y="196" fill="#ffffff" font-size="48" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(title)}</text>
    ${rows || `<text x="80" y="280" fill="rgba(255,255,255,0.72)" font-size="26" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">No prop cleared the bar.</text>`}
    <text x="80" y="568" fill="rgba(255,255,255,0.62)" font-size="22" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(truncateText(params.dateLabel, 42))}${extra ? ` · +${extra} more` : ""}</text>
    <text x="1120" y="568" text-anchor="end" fill="#fbbf24" font-size="20" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">PrizePicks vs books</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

function dailyPickLine(pick: DailyPick): string {
  const side = pick.side === "over" ? "Over" : "Under";
  return `${pick.sport}  ${pick.player}  ${side} ${pick.line} ${pick.stat}`;
}

export async function renderDailyShareCard(params: { picks: DailyPick[]; dateLabel: string }): Promise<Buffer> {
  const rowHeight = 64;
  const firstRow = 268;
  const footerGap = 72;
  const height = Math.max(OG_H, firstRow + params.picks.length * rowHeight + footerGap);
  const rows = params.picks
    .map((pick, index) => {
      const y = firstRow + index * rowHeight;
      return `<g>
        <text x="72" y="${y}" fill="#fbbf24" font-size="26" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${index + 1}</text>
        <text x="124" y="${y}" fill="#ffffff" font-size="26" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(dailyPickLine(pick))}</text>
        <text x="1128" y="${y}" text-anchor="end" fill="#86efac" font-size="26" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(`${pick.marketProbability}%`)}</text>
      </g>`;
    })
    .join("\n");
  const title = params.picks.length ? "Daily best picks" : "No qualifying picks";
  const footerY = height - 62;
  const svg = `<svg width="${OG_W}" height="${height}" viewBox="0 0 ${OG_W} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#101218"/>
        <stop offset="55%" stop-color="#07080c"/>
        <stop offset="100%" stop-color="#05060a"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.15" cy="0.1" r="0.9">
        <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${OG_W}" height="${height}" fill="url(#bg)"/>
    <ellipse cx="160" cy="80" rx="280" ry="200" fill="url(#glow)"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="${height - 80}" rx="28" fill="rgba(255,255,255,0.03)" stroke="rgba(251,191,36,0.28)" stroke-width="2"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="6" rx="3" fill="#fbbf24"/>
    <text x="80" y="118" fill="#ffffff" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">Drop</text>
    <text x="154" y="118" fill="#fbbf24" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">flow</text>
    <rect x="280" y="88" width="250" height="38" rx="19" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.45)"/>
    <text x="405" y="114" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="800" letter-spacing="0.12em" font-family="Inter, Arial, Helvetica, sans-serif">DAILY PICKS</text>
    <text x="80" y="196" fill="#ffffff" font-size="48" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(title)}</text>
    ${rows || `<text x="80" y="280" fill="rgba(255,255,255,0.72)" font-size="26" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">Nothing cleared the bar today.</text>`}
    <text x="80" y="${footerY}" fill="rgba(255,255,255,0.62)" font-size="22" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(params.dateLabel)}</text>
    <text x="1120" y="${footerY}" text-anchor="end" fill="#fbbf24" font-size="20" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">Market chance, not a lock</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export async function renderMoneylineShareCard(params: {
  sport: string;
  gameCount: number;
  dateLabel: string;
  lines: Array<{ pick: string; start: string }>;
}): Promise<Buffer> {
  const shown = params.lines.slice(0, 5);
  const rows = shown
    .map((line, index) => {
      const y = 268 + index * 58;
      return `<g>
        <text x="80" y="${y}" fill="#fbbf24" font-size="26" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(truncateText(`Pick ${line.pick} to win`, 42))}</text>
        <text x="1120" y="${y}" text-anchor="end" fill="rgba(255,255,255,0.72)" font-size="22" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(truncateText(line.start, 28))}</text>
      </g>`;
    })
    .join("\n");
  const extra = params.gameCount > shown.length ? params.gameCount - shown.length : 0;
  const title = params.gameCount ? `${params.gameCount} ${params.sport} game${params.gameCount === 1 ? "" : "s"}` : `No ${params.sport} games`;
  const svg = `<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#101218"/>
        <stop offset="55%" stop-color="#07080c"/>
        <stop offset="100%" stop-color="#05060a"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.15" cy="0.1" r="0.9">
        <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
    <ellipse cx="160" cy="80" rx="280" ry="200" fill="url(#glow)"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="${OG_H - 80}" rx="28" fill="rgba(255,255,255,0.03)" stroke="rgba(251,191,36,0.28)" stroke-width="2"/>
    <rect x="40" y="40" width="${OG_W - 80}" height="6" rx="3" fill="#fbbf24"/>
    <text x="80" y="118" fill="#ffffff" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">Drop</text>
    <text x="154" y="118" fill="#fbbf24" font-size="28" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">flow</text>
    <rect x="280" y="88" width="280" height="38" rx="19" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.45)"/>
    <text x="420" y="114" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="800" letter-spacing="0.12em" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(params.sport)} MONEYLINE</text>
    <text x="80" y="196" fill="#ffffff" font-size="48" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(title)}</text>
    ${rows || `<text x="80" y="280" fill="rgba(255,255,255,0.72)" font-size="26" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">No two-book moneyline was returned.</text>`}
    <text x="80" y="568" fill="rgba(255,255,255,0.62)" font-size="22" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(truncateText(params.dateLabel, 42))}${extra ? ` · +${extra} more` : ""}</text>
    <text x="1120" y="568" text-anchor="end" fill="#fbbf24" font-size="20" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">Central start times</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
