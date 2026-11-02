import sharp from "sharp";
import type { EdgeOpportunity } from "./types";

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

export async function renderEdgeShareCard(params: {
  opportunities: EdgeOpportunity[];
  dateLabel: string;
}): Promise<Buffer> {
  const shown = params.opportunities.slice(0, 5);
  const rows = shown
    .map((row, i) => {
      const y = 250 + i * 58;
      const pri = row.priority === "now" ? "TAKE" : row.priority === "watch" ? "WATCH" : "PASS";
      const priColor = row.priority === "now" ? "#86efac" : "#fde68a";
      const line = truncateText(row.pick.pickLine, 40);
      return `<g>
        <text x="80" y="${y}" fill="#fbbf24" font-size="26" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${i + 1}</text>
        <text x="118" y="${y}" fill="${priColor}" font-size="20" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(pri)}</text>
        <text x="220" y="${y}" fill="#ffffff" font-size="26" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(line)}</text>
      </g>`;
    })
    .join("\n");
  const extra = params.opportunities.length > shown.length ? params.opportunities.length - shown.length : 0;
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
    <rect x="280" y="88" width="210" height="38" rx="19" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.45)"/>
    <text x="385" y="114" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="800" letter-spacing="0.12em" font-family="Inter, Arial, Helvetica, sans-serif">PRIZEPICKS</text>
    <text x="80" y="186" fill="#ffffff" font-size="48" font-weight="800" font-family="Inter, Arial, Helvetica, sans-serif">${params.opportunities.length ? "Edge board" : "0 TAKE · 0 WATCH"}</text>
    ${rows || `<text x="80" y="250" fill="rgba(255,255,255,0.72)" font-size="26" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">This run found nothing to take.</text>`}
    <text x="80" y="568" fill="rgba(255,255,255,0.62)" font-size="22" font-weight="600" font-family="Inter, Arial, Helvetica, sans-serif">${escapeSvgText(truncateText(params.dateLabel, 42))}${extra ? ` · +${extra} more` : ""}</text>
    <text x="1120" y="568" text-anchor="end" fill="#fbbf24" font-size="20" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">dropflow.us/picks/edge</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
