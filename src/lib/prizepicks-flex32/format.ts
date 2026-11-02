import type { Flex32Candidate, Flex32Pick, Flex32Report } from "./types";

function fmtPick(p: Flex32Pick): string {
  const main =
    p.mainLine != null ? `  (main ${p.mainLine}${p.gapFromMain != null && p.bucket !== "standard" ? `, gap ${p.gapFromMain > 0 ? "+" : ""}${p.gapFromMain}` : ""})` : "";
  return `${p.slot}. [${p.bucket}] ${p.sport}  ${p.projection.playerName}  More ${p.projection.lineScore} ${p.projection.statDisplayName}${main}`;
}

function fmtAlt(c: Flex32Candidate, i: number): string {
  return `  ${i + 1}. [${c.bucket}] ${c.sport}  ${c.projection.playerName}  More ${c.projection.lineScore} ${c.projection.statDisplayName}  score=${c.softnessScore}`;
}

export function formatFlex32Report(report: Flex32Report): string {
  const lines: string[] = [];
  lines.push("PrizePicks Flex 3-2");
  lines.push(`  mix:        ${report.mix === "3g2s" ? "3 goblin + 2 standard" : "3 goblin + 1 standard + 1 demon"}`);
  lines.push(`  fetchedAt:  ${report.fetchedAt}${report.fromCache ? " (cache)" : " (live)"}`);
  lines.push(`  generated:  ${report.generatedAt}`);
  lines.push(
    `  board:      ${report.boardCounts.eligible} eligible / ${report.boardCounts.total} scanned  (g ${report.boardCounts.goblin} · s ${report.boardCounts.standard} · d ${report.boardCounts.demon})`
  );
  if (report.skippedSports.length) {
    lines.push(`  no slate:   ${report.skippedSports.join(", ")}`);
  }
  lines.push("");
  lines.push("LOCK THIS FLEX 5");
  for (const p of report.picks) lines.push(fmtPick(p));

  if (report.warnings.length) {
    lines.push("");
    lines.push("warnings");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  if (report.alternates.length) {
    lines.push("");
    lines.push("alternates (if a leg sells out)");
    report.alternates.forEach((c, i) => lines.push(fmtAlt(c, i)));
  }

  lines.push("");
  lines.push("Side is always More. Match the exact line in the app before locking.");
  return lines.join("\n");
}
