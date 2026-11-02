# PrizePicks research operations

`npm run prizepicks:news` is read-only. The default mode is hybrid: news-first discovery, then a bounded market-first pass when fewer than `--min-candidates` props have a valid price. `--mode news` skips the market scan. `--mode market` skips Grok discovery and still prices the board. Reports are written under `tmp/prizepicks-news/reports/`. `tmp/` is gitignored.

A valid sportsbook price without news is Tier B, labeled as a market-derived opportunity. It is not expected value. Tier A requires a verified payout model, which this install does not have. The shortlist does not fill empty Tier A slots with weaker candidates.

Budgets are separate:

- Odds API credits stop at `--max-odds-credits` (default 40).
- Grok stops at 12 calls, or sooner when `--max-grok-spend` and `XAI_USD_PER_RESEARCH` say the next call would pass the cap. The 12 covers six searches plus one narrower retry each.
- A timed-out Grok call still counts. The retry is a shorter web-only search, not the same request again. The dollar amount is unknown when `XAI_USD_PER_RESEARCH` is unset.

`--check-odds` calls the free sports list. It lists MLB events only when `--max-odds-credits` is at least 1.

`--estimate` and `--dry-run` do not call Grok or the Odds API.

There is no scheduler and no subscriber publish step on this command.
