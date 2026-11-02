# PrizePicks odds scanner redesign

Audit of the code that `npm run prizepicks:odds` runs today, and the boundary for the daily ranking engine. This document only lists integrations that exist in the repository.

## What the command does today

`scripts/prizepicks-odds.mjs` loads env files and calls `runPrizePicksOddsCli` in `src/lib/prizepicks-odds/run.ts`.

1. `fetchPrizePicksProjections` pulls the live PrizePicks board (`src/lib/prizepicks/client.ts`). Each row has a projection id, player name, team, opponent, league, stat, line, `standard` / `goblin` / `demon`, game id, and start time. There is no sportsbook player id on that type.
2. Props are kept when the league maps to an Odds API sport and the stat maps to one player-prop market (`src/lib/prizepicks-odds/markets.ts`). Combo names, quarters, halves, and innings are dropped. Leagues: NFL, NBA, WNBA, MLB, NHL, CFB, CBB.
3. The Odds API (`src/lib/prizepicks-odds/client.ts`) lists events, matches both teams (`teams.ts`), then requests up to six markets per game for region `us`. Responses cache for 12 hours under `tmp/prizepicks-odds/cache`. A call costs `x-requests-last` credits. There is no default per-run cap. `--max-credits` is an optional stop.
4. `fairFromBooks` (`consensus.ts`) converts American prices with `americanToImplied`, removes two-way vig with `devigTwoWay`, and takes the median fair probability of books that priced both sides. Fewer than two books returns nothing.
5. The disagreement view still compares that fair probability with `prizepicksImpliedProbability`: standard 50, demon over 38 / under 62, goblin over 58 / under 42. Those numbers are payout assumptions, not prices. They stay on the diagnostic board only.
6. A standard prop whose exact line is not priced can still show up when two books share a different main line (`lineIsStale`). That gap is a line difference, not a hit probability. Goblins and demons are excluded from that path.
7. `selectBiggestGaps` keeps up to six rows, any sport. Default command remains this diagnostic.
8. The diagnostic publishes HTML, JSON, and a JPEG to S3. `--estimate` does not call the Odds API.

## Other providers in the repo, and what they are not

| Integration | Where | Used by this scanner |
| --- | --- | --- |
| PrizePicks board | `src/lib/prizepicks/client.ts` | Yes |
| The Odds API | `src/lib/prizepicks-odds/client.ts` | Yes |
| xAI Grok web/X search | `src/lib/xai/client.ts` | Opt-in. `--research grok` researches the shortlist. It does not supply a probability. |
| ESPN scoreboard and box score | `src/lib/prizepicks-odds/espn-boxscore.ts` | Settlement only, for the stat groups listed below. |
| NWS forecast | `src/lib/edge-combos/providers/nws-forecast.ts` | No. Not wired in. |
| Kalshi / Polymarket | `src/lib/kalshi`, edge-finder | No. |

No minutes, usage, snap, route, lineup, handedness, park, ice-time, or rotation feed is checked into this scanner. Those features are recorded as missing. They are not filled with model output or Grok text.

No historical prop settlement table exists for this command. `prizepicks-intelligence` stores news signals and outcomes of those signals, which are a different product. Closing-line and ROI history start only when this command writes a snapshot and a later settlement file is supplied.

## Probability

The production estimate is the median no-vig book probability at the PrizePicks number.

- Half-point lines have no push (the stat is an integer, so it cannot land on x.5).
- Integer lines are rejected. A two-way over/under price does not say how much of the probability is a push.
- A moved main line is not converted into a hit probability.
- One priced point is not fit to a normal (or any other) distribution. `probAboveThreshold` exists in `devig.ts` for other products and is not used here.
- The spread between books is a range, not a calibrated confidence interval. A range wider than 10 percentage points rejects the prop.
- `modelProbability` stays null. `modelVersion` is `market-median-v1`.

## Payouts and EV

This repo does not contain a verified PrizePicks payout table. Power Play and Flex multipliers differ by state and change. Expected value is `unavailable`, not zero, until a verified table with an effective date and a source URL is supplied to the payout engine. The engine can score a caller-supplied verified table; tests use a fixture and do not treat it as live.

The 38/50/62 figures are not used in the daily EV path.

## Correlation

Same player, same game, and same team are flagged from ids on the board. Joint probability is not published. Different sports are not treated as independent. Entry EV is withheld.

## What the daily mode adds

`npm run picks:daily` is the same command as `npm run prizepicks:odds -- --mode daily`. It scans every supported sport that has a comparable prop, prices exact lines first, and requests a documented alternate market only when that exact line is missing. The printed card is the strongest qualifying individual props, not the largest line gaps.

The default disagreement command is unchanged.

### Ranking

Version `best-picks-v1`. The order is a sort key, not a probability.

1. Evidence HIGH before MODERATE. LIMITED stays off the card.
2. Higher market-implied hit chance.
3. More books.
4. Tighter book agreement.
5. Fresher quote.
6. Direct before interpolated.
7. Player name, then line, so the order does not change between runs.

HIGH means an exact line, at least three books, disagreement of 4 points or less, a quote no older than 60 minutes, and no material availability warning. MODERATE means the prop still clears the gates below, including a narrow interpolation. A 68% HIGH pick ranks ahead of a 90% interpolated pick.

### Qualification defaults

| Gate | Default | Override |
| --- | --- | --- |
| Minimum hit chance | 55% | `--min-probability` or `DAILY_MIN_MARKET_PROBABILITY` |
| Minimum books | 2 | `--min-books` or `DAILY_MIN_BOOKS` |
| Maximum quote age | 360 minutes | `--max-quote-age` or `DAILY_MAX_QUOTE_AGE_MINUTES` |
| Near tip (inside 90 minutes) | quote must be 30 minutes old or newer | fixed |
| Maximum book disagreement | 8 points | `--max-disagreement` or `DAILY_MAX_BOOK_DISAGREEMENT` |
| Maximum picks | 8 | `--max-picks` or `DAILY_MAX_PICKS` |

The card does not fill up to that maximum. Zero qualifying picks is a successful report. Inside 90 minutes of tip, a missing quote time is not fresh enough.

One player can appear twice only when the stats are different. Over and under on the same market are not both recommended.

### Hit chance versus expected value

Hit chance is the no-vig sportsbook probability. Expected value needs a verified PrizePicks payout and a joint distribution. Those are not on file, so EV stays unavailable. A likely prop is not automatically a profitable bet.

### Research

On daily and recheck, Grok runs only when `XAI_API_KEY` is set, `XAI_USD_PER_RESEARCH` is set, and `--max-grok-spend` or `DAILY_MAX_GROK_SPEND` is a positive number. Otherwise the report says research was skipped. `--research none` turns it off. `--research grok` still requires the per-call price. Grok cannot change the hit chance. A verified scratch is removed. Rumors stay warnings.

### Recheck, settlement, history

`--mode recheck` runs the same ranking and says when PrizePicks moved the line. Games that have already started are left off the card. Snapshots stay in `tmp/prizepicks-odds/snapshots`. Each daily run also writes a new folder under `artifacts/prizepicks/daily/` and does not overwrite the previous one.

`--mode settle` and `--mode backtest` are unchanged in purpose. A settled sample under 30 is reported as too small to describe the system. ROI stays unavailable.

`--rank opportunity` still prints line gaps, and those rows are not hit probabilities. `--estimate`, `--max-credits`, and `--max-grok-spend` still spend nothing until a real run.

No scheduler is installed. The command does not submit an entry.

## Odds API alternates, Grok, and settlement

Daily, entries, and recheck modes request a documented `_alternate` market only when the exact PrizePicks number was not in the primary quote. The alternate keys are the ones listed by The Odds API for NBA, WNBA, NFL, MLB, and NHL. NCAAB and NCAAF alternate keys are not in that list, so those sports are not sent an alternate request.

When two half-point lines bracket the PrizePicks number and the gap is at most 2, the hit probability is a straight line between the median no-vig prices. Wider gaps, one-sided lines, and curves that are not already monotone are left unpriced. Interpolated rows use model version `market-interpolate-v1` and are labeled interpolated. They are not treated as exact-line prices.

Grok uses the existing xAI responses client with web and X search. A verified league-source scratch removes the prop. Other research becomes a flag. It does not change the probability. A daily run skips Grok unless the key, `XAI_USD_PER_RESEARCH`, and a positive spend cap are all set.

`--mode settle` reads snapshots and ESPN box scores for NBA, WNBA, and NCAAB points, rebounds, assists, steals, blocks, and threes, plus NFL and NCAAF passing, rushing, and receiving yards and receptions. MLB, NHL, and unmatched players stay unsettled. PrizePicks payout EV stays unavailable: the public payout page does not state an effective date or jurisdiction.
