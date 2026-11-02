/** Shared HTML helpers for static picks pages. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSourcedFromLine(params: {
  dateLabel: string;
  playlistTitle: string;
  playlistUrl?: string;
}): string {
  const { dateLabel, playlistTitle, playlistUrl } = params;
  const source = playlistUrl?.trim()
    ? `<a href="${escapeHtml(playlistUrl.trim())}">${escapeHtml(playlistTitle)}</a>`
    : escapeHtml(playlistTitle);
  return `<p class="date">${escapeHtml(dateLabel)} · Sourced from ${source}</p>`;
}
