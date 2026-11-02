# Odds API diagnostics

`npm run prizepicks:news -- --check-odds` does not print the API key.

The unpaid check calls `GET /v4/sports`. A 401 or 403 is `ODDS_AUTH_FAILED`. A timeout is `ODDS_TIMEOUT`. The response headers supply remaining credits when the provider sends them.

The sports list is compared with the keys this engine uses: `baseball_mlb`, `basketball_wnba`, and `americanfootball_nfl`. A sport missing from that list is reported as not listed. The list does not prove that player props are priced.

Configured markets are the same ones the news engine is allowed to request. Documented alternate keys are named. NFL rushing attempts and passing attempts have no documented alternate in this repo, so an integer line in those markets cannot use the adjacent-line method unless the primary response already contains those half points.

Pass `--max-odds-credits 1` to spend about one credit listing MLB events. That probe reports the game count, whether the response was cached, and the credit cost. It does not request player props.

The first live news run used zero Odds API credits because whole-number props were rejected locally before any request. That local gate is gone. A later zero-credit run means the matched props never reached a request, the budget was zero, or the response came from cache.

Observed on 2026-10-10:

- The key was accepted. The free sports list left the remaining balance at 19,241.
- `baseball_mlb`, `basketball_wnba`, and `americanfootball_nfl` were all listed. Listing them did not prove player-prop coverage.
- A one-credit MLB events probe returned 2 games. The provider's last-cost header was 0, and the remaining balance did not move.
- A later news run requested NFL player props and recorded 12 credits across 5 requests. Several reception and rushing markets came back with usable prices. Some markets were empty, and one quote set was stale.
