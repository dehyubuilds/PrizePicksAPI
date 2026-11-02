# PrizePicks market inefficiency auditor

`npm run prizepicks:audit` inspects the live PrizePicks board and asks where later research should go. It does not make picks, place wagers, or publish a page.

The MLB strikeout limit in `npm run prizepicks:news` is unchanged. This command is allowed to see every category on the board.

## Commands

```bash
npm run prizepicks:audit
npm run prizepicks:audit -- --mode inventory
npm run prizepicks:audit -- --mode sources --max-grok-spend 2
npm run prizepicks:audit -- --mode markets --max-odds-credits 40
npm run prizepicks:audit -- --mode full --max-odds-credits 40 --max-grok-spend 2
npm run prizepicks:audit -- --mode report
npm run prizepicks:audit -- --estimate
```

The default mode is `inventory`. It loads the board and the free Odds API sport list. It does not call Grok and does not request event odds.

`--max-grok-spend` is required before any Grok call. If `XAI_USD_PER_RESEARCH` is unset, the spend cap cannot be enforced, so the call is skipped.

## What it records

Reports land in `tmp/prizepicks-audit/`:

- `category-inventory.json`
- `source-registry.json`
- `market-coverage.json`
- `inefficiency-observations.json`
- `category-scorecard.json`
- `opportunity-matrix.json`
- `audit-report.md`

Timestamped copies are under `snapshots/`. Observations also append to `observations.jsonl` so a later run can see whether a gap shows up on a second date.

Unknown league ids stay in the inventory as `League {id}` until the PrizePicks league catalog supplies a name. Stat labels are not used to guess the sport. Short labels such as `TNC` stay unexpanded.

Demon and goblin lines are counted. They are not compared with sportsbook prices.

A full-game sportsbook market is not treated as the same bet as a map, maps 1–2, quarter, half, period, or inning prop.

Integer lines stay unpriced unless both neighboring half-point lines are present. The auditor does not fill in a push.

## Scores

Each scorecard dimension is `UNKNOWN` when the evidence was not collected. Unknown is not stored as 0 and is not treated as a good score.

| Dimension | Rule |
| --- | --- |
| Data availability | 80 with two verified sources, 50 with one, 25 when sources are only documented |
| Historical depth | 60 only when a verified source other than the live board has a tested history span |
| Source reliability | Verified sources divided by decided sources, times 100 |
| Modeling feasibility | 55 only when that verified history exists |
| Market coverage | Exact same-scope families divided by all families, after the sport list has been checked |
| Discrepancy frequency | Share of independent events, and only after two dates and five events |
| Persistence | Count of gaps seen on two dates. Unknown on the first date |
| Pricing uncertainty | Mean absolute line gap times 10, capped at 100 |
| Operational cost | 100 minus 5 points per credit spent on that category |
| Commercial use | 100 allowed, 40 restricted, 0 prohibited, otherwise unknown |

Grok can name a source. That source stays `DOCUMENTED_BUT_UNTESTED` or `REQUIRES_SUBSCRIPTION`. A named price is kept only when Grok returned one. This process does not invent one.

## Two rankings

Investigation order prefers a resolved category name, then a confirmed same-scope market, then how many standard props are up. That is a research queue, not an edge.

The empirical ranking includes a category only when the same player, family, and direction gap was stored on two dates across at least five independent events. The first audit will usually have none.

## Not in this version

Settlement ingestion, closing-line value, calibration, and statistical significance wait until those histories exist. They are not estimated from one board.
