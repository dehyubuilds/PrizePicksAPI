# VALORANT Maps 1–2 intelligence

`npm run prizepicks:valorant` studies PrizePicks VAL Maps 1–2 kills props. It does not place wagers or publish a page. A gap between a model and a line is not expected value.

The news engine and the market auditor are unchanged.

## Command

```bash
npm run prizepicks:valorant -- --mode full --max-matches 5 --max-grok-calls 6 --max-grok-spend 2 --verbose
```

The default mode is `board`. Grok runs only in `intelligence` or `full`, and only when `--max-grok-spend` is set and `XAI_USD_PER_RESEARCH` is set. One call is used per match, up to the match and call caps.

## Scope

Eligible props are standard Maps 1–2 kills on a league whose provider name is `VAL` or `VALORANT`. Demon, goblin, combo, and maps 1–3 props are recorded or ignored, and they are not given a three-map projection.

## Model

When a player has at least five pre-match map rows with series position 1, five with series position 2, and five kills-per-round rows, the baseline is:

expected kills = shrunk kills per round × shrunk map-1 rounds + shrunk kills per round × shrunk map-2 rounds

A career average is not used to fill a missing map. Poisson is not assumed. More, Less, and push probabilities stay empty until a distribution is fitted and a held-out backtest of at least 20 matches exists.

A confirmed roster or role post does not add kills. The verdict becomes `ROLE_CHANGE_RISK` and the baseline number stays put.

## Sources

Official and statistics pages are registered and probed with a single HTTP request. The HTML is not stored as a dataset. X handles are kept only when a search returns an `x.com` or `twitter.com` URL. Handles are not hardcoded.

## Output

`tmp/prizepicks-valorant/` holds `source-registry.json`, `board.json`, `intelligence.json`, `historical-stats.json`, `projections.json`, `backtest.json`, and `report.md`, plus a timestamped snapshot.
