# Feature Research

**Domain:** Crypto protocol / tokenomics analytics dashboard (read-only, global, community-facing)
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH (patterns verified across DefiLlama, Token Terminal, Aerodrome/Velodrome, Blockworks Analytics, Dune, Dexscreener, Nansen; SLVRline-specific metrics inferred from PROJECT.md contracts + ecosystem patterns)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any serious on-chain analytics site must have. Missing these makes the site feel unfinished.

| Feature | Why Expected | Complexity | Indexer Data Dependency | Notes |
|---------|--------------|------------|------------------------|-------|
| Headline vitals strip (live numbers at top) | DefiLlama, Dexscreener, every serious analytics site leads with above-the-fold headline stats | LOW | Yes — requires indexer to serve pre-computed metrics; raw RPC calls at page-load are too slow | The "hero" specified in PROJECT.md; layout pattern: vitals at top, charts below |
| SLVR price + liquidity + 24h volume | Every token analytics page (Dexscreener, CoinMarketCap, CoinGecko) shows these by default; traders and holders consider them baseline | LOW | Partial — price can come from Dexscreener API, but on-chain liquidity depth requires indexing V2/V4 pool states |  Pull from Dexscreener for price, cross-check with on-chain V2 pair; V4 requires StateView contract reads |
| Supply breakdown (circulating vs. total vs. max cap) | Token Terminal, DefiLlama, and every tokenomics page shows this; 500k hard cap is a core SLVR value prop | LOW | Yes — circulating = total - locked - burned, requires indexer to sum burns + veSLVR locked amounts | Max cap = 500,000; never exceeds; display as progress bar toward cap |
| Historical time-series charts | Dune, DefiLlama, Token Terminal all show at minimum 30D and 1Y historical lines; any analytics site without charts feels like a data API, not a dashboard | MEDIUM | Yes — requires time-series rows in the datastore per metric; single current-value queries are insufficient | Minimum time ranges: 24H, 7D, 30D, 90D, ALL; this is a universal crypto UX convention |
| Time range selector (1D / 7D / 30D / 90D / ALL) | Universal crypto dashboard convention — all major platforms (Dexscreener, DefiLlama, CMC) implement this | LOW | No additional indexer work — depends on how deep the historical data goes | Implement as button group; "ALL" = from genesis |
| Data freshness indicator | DefiLlama refreshes every 5 minutes and shows it; Dune warns about chain lag; users cannot trust stale data they cannot date | LOW | No — just display indexer's `last_indexed_block` timestamp | Show "Last updated: 2 min ago" or block height near each live number; critical for trust |
| Mobile-responsive layout | Standard web expectation in 2026; the vitals strip + charts pattern must work on phone screens | LOW | No | Vitals strip collapses to 2-col grid on mobile; charts stack vertically; this is a CSS/layout concern, not a data concern |
| Contract/address labeling (what each address IS) | Nansen and Blockworks label protocol addresses; unidentified hex addresses erode trust in an independent analytics site | LOW | No — static labels from PROJECT.md | Label deployer, growth fund, team vesting, hub, etc. in any address-displaying view; not displayed prominently but used wherever addresses appear |
| Methodology / transparency page | DefiLlama open-sources adapter code; Token Terminal documents revenue definitions; community trust depends on "how is this calculated?" being answerable | LOW | No | One page or expandable tooltip per metric explaining the formula, the contracts used, and the data source; especially critical for Dividends APR |
| Total SLVR staked | Any staking-protocol analytics page (Ethereum staking, Aerodrome veAERO lock rate) shows this; it is the core gauge of protocol commitment | LOW | Yes — sum of veSLVR staking contract + LP staking contract holdings | Breakdowns: veSLVR staked, LP staked; shown in headline strip |
| Burns and emissions (cumulative + rate) | DefiLlama Unlocks page, Token Terminal supply charts; all tokenomics dashboards show supply inflation/deflation | MEDIUM | Yes — requires indexer to parse Transfer events to/from burn address, and emission events from Grid Lottery contracts | Dual time-series: cumulative chart + rate-per-period bar chart |
| Round-level Grid Lottery activity summary | Any GameFi or lottery protocol community will ask "how active is the game?"; bets/round and winner frequency are trust signals | MEDIUM | Yes — requires indexer to parse lottery round events from both Grid Lottery contracts (pre- and post-round 12,500) | Show: current round number, bets in current round, recent winners, jackpot size |
| Links to block explorer for verification | DefiLlama links to etherscan; Dune lets users see the SQL; every credible site lets users drill to the source | LOW | No | Each contract address should link to Blockscout (`https://robinhoodchain.blockscout.com/address/<addr>`); any transaction hash shown should be linked |

---

### Differentiators (Competitive Advantage)

Features that would make SLVRline stand out versus the protocol's own site (`slvr.fun`) and generic Dune dashboards.

| Feature | Value Proposition | Complexity | Indexer Data Dependency | Notes |
|---------|-------------------|------------|------------------------|-------|
| Dividends APR — prominently displayed, formula shown | No existing site computes or prominently headlines this yield metric; it is the unique economic hook of the SLVR protocol; miners need it to make hold/claim decisions | HIGH | Yes — formula requires: (dividends paid per period) / (total unclaimed mining rewards) * annualization factor; requires indexer to track both the SLVR Hub dividend events and the outstanding unclaimed reward pool | This is SLVRline's most differentiated headline stat; the formula derivation from the Grid Lottery + SLVR Hub contracts is the hardest research task and must happen before implementation |
| Mining runway projection ("time to 500k cap") | No DeFi analytics site shows this for SLVR; miners and long-term holders want to know how long the protocol runs | MEDIUM | Yes — requires current emission rate (SLVR minted per block or per round) from indexed data, plus remaining supply headroom (500k - total minted) | Display as "~X months at current emission rate"; refresh when emission rate changes; show as both a number and a timeline chart |
| Permanent-lock breakdown (veSLVR permanently locked vs. time-expiring) | Aerodrome's Blockworks dashboard shows this as a key governance health signal; the Aerodrome analysis notes "dominant share in Permanent and In Relays buckets" as a bullish signal; SLVR has a permanent-lock feature that is analytically meaningful | MEDIUM | Yes — requires differentiating between permanent-lock veNFTs and time-decaying locks in the Vote Escrow NFT contract; indexer must track lock type per NFT | Show as stacked bar or donut: permanent vs. time-decaying; compare to total staked SLVR |
| Lottery activity depth (round chart with bets + winners over time) | Dune community dashboards for lottery protocols show round-by-round history; it proves the game is active and not wash-play | MEDIUM | Yes — requires indexer to have all round events from both lottery contracts, split at round 12,500; each round needs: round number, total bets, winner(s), SLVR emitted, jackpot size | Key differentiator vs. slvr.fun which only shows current-round state; show all-time and per-round trend |
| Multi-pool market view (V2 + V4 + SwapHood in one pane) | Dexscreener shows individual pools; SLVRline can aggregate all ~16 SLVR markets into one consolidated view with breakdown; traders want total liquidity across venues | MEDIUM | Partial — Dexscreener API covers most; V4 pool states require StateView contract reads; SwapHood V3 is a separate subgraph or RPC | Display: total aggregate liquidity, then breakdown by venue; link each pool to Dexscreener or Blockscout |
| Emissions-to-revenue ratio (ve(3,3) health gauge) | Aerodrome's analytics call this "the protocol's most important fundamental metric"; showing SLVR emissions vs. protocol fees/dividends funded gives a sustainability signal | MEDIUM | Yes — requires indexer to track total emissions per period and total dividends/fees paid per period | Show as ratio trend over time; green = revenue exceeds emissions, red = emissions exceed revenue |
| Screenshot-friendly stat cards | Wordle and BeReal established that shareable one-frame screenshots drive community virality; analytics sites rarely optimize for this; a "copy stats" or "share card" for daily headline numbers would be unique | LOW | No — purely frontend | Static layout designed so vitals strip screenshots beautifully at 375px width (iPhone viewport); optionally add a /share route with an OG-image-style card per metric family |
| Independent source-of-truth positioning | slvr.fun is the protocol's own site; SLVRline's value is that it computes from raw chain data independently; displaying "computed from indexed chain data, not from protocol frontend" establishes trust | LOW | No — purely copy and methodology page | Tagline in header/footer; links to specific contracts used; methodology page with formulas |
| Subgraph cross-check diff view (advanced) | Power users and validators want to know if SLVRline disagrees with the Goldsky subgraph; surfacing discrepancies would be unique | HIGH | Yes — requires running both subgraph queries and own indexer, then diffing | Defer to v2; too complex for v1 but worth noting as a long-term trust feature |

---

### Anti-Features (Deliberately Not Building)

Features that seem reasonable but should be excluded from v1 with explicit reasoning.

| Anti-Feature | Why Requested | Why Avoid | What to Do Instead | v2 Candidate? |
|--------------|---------------|-----------|-------------------|---------------|
| Wallet connect / "your position" dashboard | Users naturally want to see their own stake, unclaimed rewards, and lottery history | Adds authentication complexity, wallet library dependencies, RPC call management per user, and completely changes the security surface; global stats are independently simpler and more trusted; PROJECT.md explicitly defers this | Show global stats with clear labeling ("Protocol-wide totals"); add "Connect Wallet" as a visible future feature teaser | YES — explicit v2 fast-follow per PROJECT.md |
| Trading / swap / any write action | Traders will ask "can I buy SLVR here?" | Analytics site = read-only; adding swap would require integrating a DEX router, handling slippage, managing wallet state, and dramatically widening scope; also blurs the "independent analytics" positioning | Link out to Uniswap V4 or swaphood for trading; add "Trade SLVR" external link in nav | No |
| Price alerts / notifications | Power users want to be notified on price moves or APR changes | Requires backend push infrastructure (email, push, webhooks), user accounts, notification preferences; disproportionate backend complexity for a static analytics site | Dexscreener and CoinGecko already provide alerts for SLVR price; link to them | Possibly v3 |
| AI-generated narratives / "what does this mean?" | Trendy in 2026 analytics tools; some users would like LLM summaries of metric changes | Adds LLM API cost, hallucination risk, and maintenance burden; for a community trust-oriented site, synthetic analysis undermines the "raw data" credibility | Let the charts speak; add methodology tooltips for each metric | No |
| Governance voting / veSLVR voting | Community members will ask for governance features | Write action; requires wallet connect, on-chain tx signing; completely out of scope for read-only site | Link to slvr.fun for governance actions | v2+ |
| Jackpot insurance analytics | Insurance data is available but source is unverified (`0xf9D2540662F48F21364B98240574384Fe88e8F2f`); community may ask for it | PROJECT.md explicitly excludes this: "contract source unverified; avoid indexing an untrusted surface"; indexing an untrusted contract could produce misleading data | Exclude entirely; note in methodology page that insurance data is out of scope | Only after contract is verified |
| Predictive / speculative metrics ("projected price", "APR forecast") | Users want signals | Analytics sites that speculate erode trust in their factual data; DefiLlama and Token Terminal deliberately avoid price predictions | Stick to historical and current metrics; show runway projection only as "at current emission rate" (clearly labeled as extrapolation, not forecast) | No |
| Complex filtering / multi-protocol comparisons | Power analysts want to compare SLVR metrics to other protocols | SLVR-only scope makes this irrelevant for v1; adding multi-protocol data requires integrating other subgraphs or APIs | Build single-protocol depth first; comparison can be added if the community requests it | v3 |
| Real-time WebSocket streaming for all metrics | Traders want tick-by-tick data | Dramatically increases infrastructure complexity (WebSocket server, connection management); most analytics metrics are meaningful at 5-minute refresh granularity; price already served by Dexscreener in near real-time | Use polling (30s for live numbers, 5min for computed metrics); only real-time for current lottery round state if needed | No |
| CSV / data export | Power users and researchers want raw data | Adds API surface, rate limiting concerns, and is better served by the existing Goldsky subgraph or direct RPC access for serious researchers | Document the Goldsky subgraph endpoint in methodology page as the data export path | Possibly v2 via API endpoint |

---

## Feature Dependencies

```
[Indexer: full historical event log]
    └──required by──> [Historical time-series charts]
    └──required by──> [Burns + emissions chart]
    └──required by──> [Round-level lottery activity]
    └──required by──> [Mining runway projection]
    └──required by──> [Dividends APR calculation]
    └──required by──> [Permanent-lock breakdown]
    └──required by──> [Emissions-to-revenue ratio]

[Indexer: current-state computed metrics]
    └──required by──> [Headline vitals strip]
    └──required by──> [Total SLVR staked]
    └──required by──> [Supply breakdown]
    └──required by──> [Current round / jackpot state]

[Headline vitals strip]
    └──enhances──> [Screenshot-friendly stat cards]
    └──anchors──> [Historical charts below] (layout dependency — strip must exist before charts make sense)

[Supply breakdown]
    └──required by──> [Mining runway projection]
        └──requires also──> [Current emission rate from indexer]

[Round-level lottery indexing — pre+post round 12,500 split]
    └──required by──> [Round activity chart]
    └──required by──> [Mining runway projection] (emission rate derived from round data)
    └──required by──> [Dividends APR] (dividend events correlated with round events)

[Dividends APR formula — contract research]
    └──must precede──> [Dividends APR implementation]
    (This is a research gate, not just a code gate — the formula must be derived from
    Grid Lottery + SLVR Hub contracts before any implementation; treat as Phase 1 deliverable)

[SLVR price from Dexscreener API]
    └──independent of indexer──> [Price in vitals strip]
    └──enables──> [Emissions-to-revenue ratio] (needs price to express ratio in USD terms)

[Multi-pool market data (V2 + V4 + SwapHood)]
    └──partially independent──> [Dexscreener API covers ~16 markets]
    └──V4 pools require──> [StateView contract reads or indexer]
```

### Dependency Notes

- **Dividends APR requires formula research first:** The exact on-chain formula (how the SLVR Hub distributes dividends to unclaimed reward holders) must be reverse-engineered from the Grid Lottery and SLVR Hub contracts before any implementation. This is the highest-risk unknown in the entire project. Treat it as a Phase 1 research task that gates Phase 2 implementation.

- **Round 12,500 split is a correctness gate:** Any feature that uses historical lottery data (rounds, emissions, winners, runway) requires the indexer to correctly handle the contract migration at round 12,500 (2026-07-23). Double-counting or missing rounds would corrupt downstream metrics. This indexer requirement must be in Phase 1.

- **Headline vitals strip is the anchor:** All other features orient around the strip. Build it first; charts and detail pages are additive below it.

- **Price is the easiest metric to get live:** Dexscreener API requires no indexer work. Use it to ship the price headline quickly and as a baseline for validating API connectivity.

- **Methodology page is a dependency for trust, not a late deliverable:** Write it early alongside each metric implementation. Retrofitting explanations is harder than writing them as you go.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what the community needs to call this a real analytics site.

- [ ] **Headline vitals strip** — Dividends APR, total SLVR staked, circulating/total/max supply, mining runway, SLVR price. These 5 numbers in one glanceable row are the entire value prop; nothing else ships without them.
- [ ] **Data freshness indicator** — "Last updated X min ago" per live stat. Without this, the site cannot be trusted.
- [ ] **Supply time-series chart** — Circulating supply, cumulative burns, cumulative emissions over ALL time. This is the foundational tokenomics view.
- [ ] **Staking time-series chart** — Total SLVR staked (veSLVR + LP) over time, with permanent-lock breakdown.
- [ ] **Mining runway projection** — Single headline number ("~14 months at current rate") + supporting chart of emission rate over time.
- [ ] **Grid Lottery activity chart** — Bets per round (or per day), winner frequency, current jackpot size. Shows the game is alive.
- [ ] **SLVR price + liquidity chart** — 7D / 30D price chart using Dexscreener data; total liquidity across pools.
- [ ] **Methodology page** — Formulas for each metric, contract addresses used, link to Goldsky subgraph as cross-check.
- [ ] **Mobile-responsive layout** — Vitals strip + charts must work on iPhone viewport (375px).
- [ ] **Contract address labels** — Named labels for all protocol contracts wherever addresses appear.

### Add After Validation (v1.x)

- [ ] **Dividends APR historical chart** — The headline number launches in v1; the history chart adds depth once the formula is validated in production.
- [ ] **Multi-pool market breakdown** — Aggregate liquidity by pool/venue, not just total. Add after the single aggregate price view is stable.
- [ ] **Emissions-to-revenue ratio** — Protocol health gauge. Add once both emissions and dividends data are confirmed accurate.
- [ ] **Lottery round deep-dive** — Click a round in the chart to see round-level detail (bets, winners, amounts). Adds after core round summary is live.
- [ ] **Screenshot / share card** — OG-image endpoint or copy-to-clipboard for daily vitals. Add once visual design is locked.

### Future Consideration (v2+)

- [ ] **Wallet connect + personal position dashboard** — Explicit v2 per PROJECT.md; do not scope into v1.
- [ ] **Subgraph diff view** — Compare SLVRline data to Goldsky subgraph; valuable for power users but high complexity.
- [ ] **CSV/API export** — Power user feature; serve the Goldsky subgraph endpoint in the meantime.
- [ ] **Jackpot insurance analytics** — Only after the insurance contract source is verified.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Headline vitals strip | HIGH | LOW (once indexer serves computed metrics) | P1 |
| Dividends APR (formula + display) | HIGH | HIGH (formula research + indexer logic) | P1 |
| Data freshness indicator | HIGH | LOW | P1 |
| Supply chart (circulating / burns / emissions) | HIGH | MEDIUM | P1 |
| Staking chart (total staked + permanent-lock) | HIGH | MEDIUM | P1 |
| Mining runway projection | HIGH | MEDIUM | P1 |
| Grid Lottery activity chart | MEDIUM | MEDIUM | P1 |
| SLVR price + liquidity chart | HIGH | LOW (Dexscreener API) | P1 |
| Methodology / transparency page | HIGH | LOW | P1 |
| Mobile-responsive layout | HIGH | LOW | P1 |
| Contract address labels + Blockscout links | MEDIUM | LOW | P1 |
| Dividends APR historical chart | MEDIUM | LOW (once formula is live) | P2 |
| Multi-pool market breakdown | MEDIUM | MEDIUM | P2 |
| Emissions-to-revenue ratio | MEDIUM | MEDIUM | P2 |
| Round deep-dive (per-round detail) | MEDIUM | MEDIUM | P2 |
| Screenshot / share card | LOW | LOW | P2 |
| Wallet connect / personal dashboard | HIGH | HIGH | P3 (v2) |
| Subgraph diff view | LOW | HIGH | P3 (v2) |
| CSV / API export | LOW | MEDIUM | P3 (v2) |

---

## Competitor Feature Analysis

| Feature | DefiLlama | Aerodrome (Blockworks) | Dexscreener | slvr.fun (official site) | SLVRline approach |
|---------|-----------|------------------------|-------------|--------------------------|-------------------|
| Headline vitals | Yes — TVL, volume, fees at top | Yes — tabbed by metric family | Yes — price, liquidity, volume per pair | Partial — shows deployed capital, countdown; no APR or supply | Full vitals strip: APR + staked + supply + runway + price in one row |
| Historical charts | Yes — linear/log, multiple timeframes | Yes — per-tab per-metric | Yes — TradingView integration | No | Time-series for all metric families; 24H/7D/30D/90D/ALL selector |
| Data freshness | Yes — "refreshed every 5 min" label | Not prominently shown | Yes — near real-time with timestamp | Unknown | "Last updated X ago" on every live number; block height shown |
| Methodology transparency | Yes — open-source adapters on GitHub | No | No | No | Dedicated page with formula for each metric, contracts cited |
| Mobile responsive | Yes | Partial | Yes | Yes | Yes — required for community sharing |
| Permanent-lock breakdown | No (general staking data) | Yes — dominant feature for veAERO governance analysis | No | No | Yes — key ve(3,3) health signal for SLVRline |
| Protocol-specific yield (APR) | Yes — aggregated across protocols | Yes — per-epoch vote revenue | No | No (separate /calculator page) | Yes — Dividends APR as headline #1; most distinctive metric |
| Lottery / game activity | No | No | No | Yes — current round only | Yes — historical round chart, winner frequency, jackpot state |
| Mining runway | No | No (different model) | No | No | Yes — unique to SLVR's fixed-cap model |
| Wallet connect | No for global analytics | Yes for voting | Yes for alerts/watchlists | Yes (required for game) | No for v1; explicit v2 |
| Trading / swap | No (links out) | No (links to DEX) | Yes (direct execution) | Yes (the main UI) | No — link out only |

---

## Sources

- DefiLlama product tour and feature list: [https://www.dextools.io/tutorials/what-is-defillama-defi-analytics-guide-2026](https://www.dextools.io/tutorials/what-is-defillama-defi-analytics-guide-2026) — MEDIUM confidence (third-party guide, cross-checked against defillama.com navigation)
- DefiLlama homepage navigation and UI patterns: [https://defillama.com/](https://defillama.com/) — MEDIUM confidence (WebFetch of live site)
- Aerodrome / ve(3,3) analytics feature breakdown: [https://blockworks.com/insights/aerodrome-finance](https://blockworks.com/insights/aerodrome-finance) — MEDIUM confidence (Blockworks proprietary dashboard description)
- DeFi analytics stack best practices: [https://formo.so/blog/defi-crypto-analytics-stack](https://formo.so/blog/defi-crypto-analytics-stack) — MEDIUM confidence (practitioner analysis, multiple platforms covered)
- Token Terminal feature overview: [https://eco.com/support/en/articles/14800365-what-is-token-terminal-onchain-financial-data-explained](https://eco.com/support/en/articles/14800365-what-is-token-terminal-onchain-financial-data-explained) and [https://tokenterminal.com/](https://tokenterminal.com/) — MEDIUM confidence
- Sablier on-chain analytics platform comparison: [https://blog.sablier.com/onchain-analytics-platforms-for-crypto-teams-2026](https://blog.sablier.com/onchain-analytics-platforms-for-crypto-teams-2026) — MEDIUM confidence (verified against known platform features)
- Dexscreener UI and features: [https://www.bitbond.com/resources/dex-screener-the-ultimate-guide](https://www.bitbond.com/resources/dex-screener-the-ultimate-guide) — MEDIUM confidence
- Time range selector as universal convention: multiple crypto dashboard GitHub repos and community references — MEDIUM confidence
- SLVR protocol official site (what slvr.fun currently shows): [https://slvr.fun/](https://slvr.fun/) — HIGH confidence (direct WebFetch of live site)
- SLVRline project requirements: `/Users/timwilliams/conductor/workspaces/slvrline-dashboard/bozeman/.planning/PROJECT.md` — HIGH confidence (authoritative spec)

---

*Feature research for: crypto protocol tokenomics analytics dashboard (SLVRline / SLVR mining protocol)*
*Researched: 2026-07-24*
