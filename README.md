# PrizePicksAPI

Standalone PrizePicks tooling:

1. **Express scraper API** (`npm start`) — game/player lines via scraping
2. **CLI research stack** — PrizePicks board + [The Odds API](https://the-odds-api.com/) sportsbook consensus + [xAI Grok](https://console.x.ai) web/X search

Copied from the Dropflow monorepo so Odds / Grok scripts run here without the music product.

## Setup

```bash
cd ~/Desktop/PrizePicksAPI
cp .env.example .env.local
# Fill THE_ODDS_API_KEY, XAI_API_KEY, optional PRIZEPICKS_BROWSER_COOKIE
npm install
```

Scripts also fall back to `../Dropflow/.env.local` and `../Statics/.env.local` if keys are already there.

## CLI (Odds API + Grok)

```bash
npm run prizepicks:pull                 # live PrizePicks board
npm run prizepicks:odds -- --estimate   # Odds API credit estimate (no spend)
npm run prizepicks:odds                 # props vs sportsbooks
npm run picks:daily                     # daily mode (Grok research when configured)
npm run prizepicks:intelligence         # slate intelligence + Grok
npm run prizepicks:news                 # news / X research path
npm run prizepicks:audit                # market auditor
npm run prizepicks:valorant             # Valorant intelligence
npm run prizepicks:flex32               # Flex 3–2 helper
npm run prizepicks:edge                 # edge scan (Kalshi/Polymarket optional)
npm run prizepicks:trim-cookie          # trim browser cookie paste
```

Grok uses xAI Responses with `web_search` and `x_search` tools (`src/lib/xai/client.ts`). Cap spend with `--max-grok-spend` and set `XAI_USD_PER_RESEARCH`.

## Express API

```bash
npm run dev    # nodemon
npm start      # node index.js
```

## Tests

```bash
npm test
# or: npm run test:prizepicks-odds
```

## Layout

```
index.js / routes / controllers / leagues   # original Express API
src/lib/prizepicks*                         # board client + research modules
src/lib/xai                                 # Grok client
src/lib/prizepicks-odds                     # The Odds API consensus
scripts/prizepicks-*.mjs                    # CLI entrypoints
docs/PRIZEPICKS_*.md                        # design notes
tests/                                      # unit tests
```
