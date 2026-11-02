# MLB strikeouts, WNBA, and NFL research

`npm run prizepicks:news` is the news-first command. It does not wager or publish, and it does not run the full market-first scan.

Scope is locked in code to MLB, WNBA, and NFL. MLB candidates must be pitcher strikeouts. WNBA and NFL use the supported player props, with rebounds and receptions ordered first.

```bash
npm run prizepicks:news -- --estimate
npm run prizepicks:news -- --dry-run
npm run prizepicks:news -- --check-odds
npm run prizepicks:news -- --sports MLB,WNBA,NFL --max-events 10 --max-odds-credits 40 --verbose
```

Grok searches are one short task for MLB and WNBA, and four short tasks for NFL (injuries, roles, starters, weather). Each request sets `max_turns` to 2 so the model cannot run an open-ended search. A timeout retries once as a shorter web-only search with `max_turns` 1, counts toward the 12-call cap, and keeps the other tasks. Dollar cost stays unknown unless `XAI_USD_PER_RESEARCH` is set. Tool counts are reported only when the provider includes them.

Whole-number PrizePicks lines are sent to the Odds API. A price is a three-way less/push/more split only when the surrounding half-point lines support it. A two-way price at the integer itself is conditional on no push and is not treated as a hit chance. Entry expected value stays unavailable until PrizePicks payout rules are verified.

The market-first commands `npm run prizepicks:odds` and `npm run picks:daily` are unchanged.
