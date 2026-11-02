import { discordPremiumPicksConfigured } from "@/lib/discord/post-premium-picks";
import type { EdgeScanPick } from "./types";
import { EDGE_FINDER_DISCLAIMER } from "./reasoning";

const EMBED_CHAR_LIMIT = 6000;
const FIELD_VALUE_MAX = 1024;

type DiscordEmbed = {
  title?: string;
  description?: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer?: { text: string };
};

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatPickBlock(pick: EdgeScanPick, index: number): { name: string; value: string; inline: boolean } {
  const edge =
    pick.edgePercent === null
      ? "n/a"
      : `${pick.edgePercent >= 0 ? "+" : ""}${pick.edgePercent}%`;
  const lines = [
    `**${pick.pickLine}**`,
    `Edge: **${edge}** · Confidence: **${pick.confidenceScore}/100 (${pick.confidenceLabel})**`,
    pick.kalshiImpliedProb !== null
      ? `Kalshi implied: **${pick.kalshiImpliedProb}%** · PrizePicks implied: **${pick.prizepicksImpliedProb}%**`
      : `PrizePicks implied: **${pick.prizepicksImpliedProb}%** · Kalshi: no strong match`,
    pick.kalshi ? `Kalshi: ${pick.kalshi.marketTitle} (${pick.kalshi.ticker})` : null,
    "",
    pick.reasoning,
  ].filter((line) => line !== null);

  return {
    name: `${index}. ${pick.playerName} · ${pick.sport}`.slice(0, 256),
    value: truncate(lines.join("\n"), FIELD_VALUE_MAX),
    inline: false,
  };
}

function buildEmbeds(params: {
  premiumPicks: EdgeScanPick[];
  demonWatchlist: EdgeScanPick[];
  dateLabel: string;
}): DiscordEmbed[] {
  const embeds: DiscordEmbed[] = [];
  const header: DiscordEmbed = {
    title: "📊 Dropflow Premium Edge Board",
    description: truncate(
      `Top ranked premium edges for ${params.dateLabel}. Ranked by expected value — not payout size.\n\n${EDGE_FINDER_DISCLAIMER}`,
      4096
    ),
    color: 0x7c3aed,
    fields: [],
  };

  let current: DiscordEmbed = { ...header, fields: [] };

  const sections: Array<{ title: string; picks: EdgeScanPick[]; emoji: string }> = [
    { title: "Premium Picks", picks: params.premiumPicks, emoji: "⭐" },
    { title: "Demon Watchlist", picks: params.demonWatchlist, emoji: "👹" },
  ];

  for (const section of sections) {
    if (!section.picks.length) continue;
    current.fields.push({
      name: `${section.emoji} ${section.title}`,
      value: truncate(
        section.picks.map((pick) => `• ${pick.pickLine} (${pick.edgePercent ?? "n/a"}% edge)`).join("\n"),
        FIELD_VALUE_MAX
      ),
      inline: false,
    });

    for (const pick of section.picks) {
      const field = formatPickBlock(pick, current.fields.length);
      const next = { ...current, fields: [...current.fields, field] };
      const charCount =
        (next.title?.length ?? 0) +
        (next.description?.length ?? 0) +
        next.fields.reduce((sum, row) => sum + row.name.length + row.value.length, 0);
      if (charCount > EMBED_CHAR_LIMIT && current.fields.length > 0) {
        embeds.push(current);
        current = { color: 0x7c3aed, fields: [field] };
      } else {
        current = next;
      }
    }
  }

  if (current.fields.length) {
    current.footer = { text: `Dropflow Edge Finder · ${params.dateLabel} · ${EDGE_FINDER_DISCLAIMER}` };
    embeds.push(current);
  }

  return embeds.slice(0, 10);
}

export async function postEdgeFinderPremiumToDiscord(params: {
  premiumPicks: EdgeScanPick[];
  demonWatchlist: EdgeScanPick[];
  dateLabel?: string;
}): Promise<{ messageId: string; channelId: string } | { error: string }> {
  if (!discordPremiumPicksConfigured()) {
    return { error: "Discord premium picks channel is not configured." };
  }

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_PREMIUM_PICKS_CHANNEL_ID?.trim();
  if (!token || !channelId) {
    return { error: "DISCORD_BOT_TOKEN or DISCORD_PREMIUM_PICKS_CHANNEL_ID is missing." };
  }

  const picks = params.premiumPicks.filter((pick) => pick.category === "premium");
  const demons = params.demonWatchlist.filter((pick) => pick.category === "demon");
  if (!picks.length && !demons.length) {
    return { error: "No premium or demon watchlist picks to post." };
  }

  const embeds = buildEmbeds({
    premiumPicks: picks,
    demonWatchlist: demons,
    dateLabel: params.dateLabel ?? new Date().toLocaleDateString("en-US"),
  });

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ embeds }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `Discord API error (${res.status}). ${detail.slice(0, 180)}` };
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) return { error: "Discord did not return a message id." };
  return { messageId: data.id, channelId };
}

export { discordPremiumPicksConfigured as edgeFinderDiscordConfigured };
