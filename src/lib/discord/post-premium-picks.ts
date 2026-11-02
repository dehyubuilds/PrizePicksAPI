import { formatKalshiDiscordLine } from "@/lib/kalshi/pick-data";
import type { KalshiPickData } from "@/lib/kalshi/types";

type DiscordExplanationSection = { heading: string; body: string };

type DiscordPickLine = {
  label: string;
  pickLine: string;
  explanationSummary?: string;
  explanationSections?: DiscordExplanationSection[];
  kalshi?: KalshiPickData;
};

type DiscordEmbed = {
  title?: string;
  description?: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer?: { text: string };
};

const EMBED_CHAR_LIMIT = 6000;
const FIELD_VALUE_MAX = 1024;
const MAX_EMBEDS = 10;

function discordBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

function discordPremiumPicksChannelId(): string | null {
  return process.env.DISCORD_PREMIUM_PICKS_CHANNEL_ID?.trim() || null;
}

function truncateDiscordField(value: string, max = 1024): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function embedCharCount(embed: DiscordEmbed): number {
  let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text?.length ?? 0);
  for (const field of embed.fields) {
    total += field.name.length + field.value.length;
  }
  return total;
}

function formatPickFieldValue(pick: DiscordPickLine): string {
  const lines: string[] = [`**${pick.pickLine.trim()}**`];
  const summary = pick.explanationSummary?.trim();
  if (summary) {
    lines.push("", summary);
  }
  for (const section of pick.explanationSections ?? []) {
    const heading = section.heading?.trim();
    const body = section.body?.trim();
    if (!heading && !body) continue;
    lines.push("");
    if (heading) lines.push(`**${heading}**`);
    if (body) lines.push(body);
  }
  const kalshiLine = formatKalshiDiscordLine(pick.kalshi);
  if (kalshiLine) {
    lines.push("", kalshiLine);
  }
  return truncateDiscordField(lines.join("\n"), FIELD_VALUE_MAX);
}

function buildPremiumPicksEmbeds(params: {
  picks: DiscordPickLine[];
  pageTitle: string;
  pageSummary: string;
  dateLabel?: string;
}): DiscordEmbed[] {
  const footerText = params.dateLabel
    ? `Dropflow Premium Picks · ${params.dateLabel} · For entertainment only — not gambling advice.`
    : "Dropflow Premium Picks · For entertainment only — not gambling advice.";

  const embeds: DiscordEmbed[] = [];
  let current: DiscordEmbed = {
    title: truncateDiscordField(params.pageTitle, 256),
    description: truncateDiscordField(params.pageSummary, 4096),
    color: 0x7c3aed,
    fields: [],
  };

  for (const pick of params.picks) {
    const field = {
      name: `${embeds.length + current.fields.length + 1}. ${pick.label}`.slice(0, 256),
      value: formatPickFieldValue(pick),
      inline: false,
    };
    const next: DiscordEmbed = {
      ...current,
      fields: [...current.fields, field],
    };
    if (current.fields.length > 0 && embedCharCount(next) > EMBED_CHAR_LIMIT) {
      embeds.push(current);
      current = { color: 0x7c3aed, fields: [field] };
      continue;
    }
    current = next;
  }

  if (current.fields.length > 0 || embeds.length === 0) {
    current.footer = { text: footerText };
    embeds.push(current);
  } else if (embeds.length > 0) {
    embeds[embeds.length - 1]!.footer = { text: footerText };
  }

  return embeds.slice(0, MAX_EMBEDS);
}

/** Post today's premium picks to the configured Discord channel (Discord-only delivery — no web link). */
export async function postPremiumPicksToDiscord(params: {
  picks: DiscordPickLine[];
  pageTitle: string;
  pageSummary: string;
  dateLabel?: string;
}): Promise<{ messageId: string; channelId: string } | { error: string }> {
  const token = discordBotToken();
  const channelId = discordPremiumPicksChannelId();
  if (!token) return { error: "DISCORD_BOT_TOKEN is not configured." };
  if (!channelId) return { error: "DISCORD_PREMIUM_PICKS_CHANNEL_ID is not configured." };
  if (!params.picks.length) return { error: "No premium picks to post." };

  const embeds = buildPremiumPicksEmbeds(params);

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
    console.error("[discord] premium picks post failed", res.status, detail.slice(0, 400));
    return {
      error: `Discord API error (${res.status}). Check bot permissions and channel ID.`,
    };
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) return { error: "Discord did not return a message id." };
  return { messageId: data.id, channelId };
}

export function discordPremiumPicksConfigured(): boolean {
  return Boolean(discordBotToken() && discordPremiumPicksChannelId());
}
