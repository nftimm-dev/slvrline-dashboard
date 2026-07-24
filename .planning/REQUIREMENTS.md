# Requirements: SLVRline

**Defined:** 2026-07-24
**Core Value:** The community can trust SLVRline as the single, independent source of truth for the SLVR protocol's vitals — especially Dividends APR and supply/runway — computed from our own indexed chain data.

## v1 Requirements

Requirements for initial release. Each maps to a roadmap phase.

### Data & Trust

- [ ] **DATA-01**: Site serves all protocol metrics from SLVRline's own indexer + database (independent of slvr.fun), not proxied from the protocol's frontend
- [ ] **DATA-02**: Historical lottery/emissions data is correct across the round-12,500 contract migration — events split at the boundary and keyed by `chain_id + address`, with no missing or double-counted rounds
- [ ] **DATA-03**: Visitor sees a freshness indicator (last-updated time and/or indexed block height) on every live number
- [ ] **DATA-04**: Visitor can read a methodology page documenting each metric's formula, the contracts used, and the data source
- [ ] **DATA-05**: Visitor sees human-readable labels for protocol contract/wallet addresses, each linking to Blockscout

### Headline Vitals

- [ ] **VITALS-01**: Visitor sees a headline vitals strip showing Dividends APR, total SLVR staked, supply (circulating/total/max), mining runway, and SLVR price in one glanceable row
- [ ] **VITALS-02**: The vitals strip is mobile-responsive and screenshot-friendly at a 375px (iPhone) viewport

### Dividends APR

- [ ] **DIV-01**: The Dividends APR formula is derived from the Grid Lottery + SLVR Hub contracts and cross-validated against the Goldsky subgraph before any value is displayed
- [ ] **DIV-02**: Visitor sees the current Dividends APR as a prominent headline number with its formula accessible via the methodology page/tooltip

### Supply & Runway

- [ ] **SUP-01**: Visitor sees circulating vs. total vs. 500,000 max supply, including a visual progress-toward-cap
- [ ] **SUP-02**: Visitor sees cumulative burns and cumulative emissions, plus their rate over time, as a historical chart
- [ ] **SUP-03**: Visitor sees a mining runway projection ("~X months at current emission rate") with a supporting chart, clearly labeled as an extrapolation (not a forecast)

### Staking

- [ ] **STK-01**: Visitor sees total SLVR staked (veSLVR + LP staking) as a headline number and as a time-series over history
- [ ] **STK-02**: Visitor sees the permanent-lock breakdown — SLVR permanently locked vs. time-decaying veSLVR

### Market

- [ ] **MKT-01**: Visitor sees the SLVR price (from Dexscreener, cross-checked against the on-chain reference pool) with a 7D/30D price chart
- [ ] **MKT-02**: Visitor sees total SLVR liquidity aggregated across pools

### Grid Lottery (Mining)

- [ ] **LOT-01**: Visitor sees the current Grid Lottery round state — round number, bets in the round, recent winners, and jackpot size
- [ ] **LOT-02**: Visitor sees historical Grid Lottery activity over time (bets per round, winner frequency) spanning both the pre- and post-migration contracts

### Presentation

- [ ] **UI-01**: Historical charts support a time-range selector (24H / 7D / 30D / 90D / ALL)
- [ ] **UI-02**: The site presents a distinct, polished "silver" branded analytics identity (its own look, not a clone of slvr.fun)

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Personalization

- **WALLET-01**: Visitor can connect a wallet to see their own stake, unclaimed rewards, and pending dividends
- **WALLET-02**: Personal Grid Lottery history for a connected wallet

### Deeper Analytics

- **DIV-H1**: Dividends APR historical chart (added once the formula is validated in production)
- **MKT-H1**: Multi-pool market breakdown — aggregate liquidity by venue (V2 / V4 / SwapHood), not just a single total
- **HEALTH-01**: Emissions-to-revenue ratio (ve(3,3) sustainability gauge)
- **LOT-H1**: Lottery round deep-dive — click a round to see round-level detail (bets, winners, amounts)
- **SHARE-01**: Screenshot / share card (OG-image endpoint or copy-to-clipboard) for daily vitals
- **TRUST-01**: Subgraph cross-check diff view — surface discrepancies between SLVRline and the Goldsky subgraph
- **EXPORT-01**: CSV / API data export

## Out of Scope

Explicitly excluded from this product direction. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Trading / swap / any write action | Read-only analytics site; adding a DEX router widens scope and blurs the independent-analytics positioning. Link out to Uniswap/SwapHood instead. |
| Price alerts / notifications | Requires push infra + user accounts; disproportionate for a static analytics site. Dexscreener/CoinGecko already alert on SLVR price. |
| AI-generated narratives / summaries | LLM cost + hallucination risk undermines "raw data" credibility. Let the charts and methodology speak. |
| Governance voting / veSLVR voting | Write action requiring wallet + tx signing; out of scope for read-only. Link to slvr.fun. |
| Jackpot-insurance analytics | Contract source unverified (`0xf9D2540…`); indexing an untrusted surface risks misleading data. Revisit only if verified. |
| Predictive / speculative metrics (price/APR forecasts) | Speculation erodes trust in factual data. Runway is shown only as "at current rate," clearly labeled as extrapolation. |
| Multi-protocol comparisons | SLVR-only scope; comparison requires other subgraphs/APIs. Build single-protocol depth first. |
| Real-time WebSocket streaming | Polling (live vitals ~10–30s, computed metrics ~5min) is sufficient; WebSocket infra is disproportionate. |

## Traceability

Which phase covers each v1 requirement. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DIV-01 | Phase 1 | Pending |
| STK-01 | Phase 2 | Pending |
| STK-02 | Phase 2 | Pending |
| LOT-02 | Phase 2 | Pending |
| SUP-01 | Phase 3 | Pending |
| SUP-02 | Phase 3 | Pending |
| SUP-03 | Phase 3 | Pending |
| LOT-01 | Phase 3 | Pending |
| MKT-01 | Phase 4 | Pending |
| MKT-02 | Phase 4 | Pending |
| DATA-03 | Phase 5 | Pending |
| DATA-04 | Phase 5 | Pending |
| DATA-05 | Phase 5 | Pending |
| VITALS-01 | Phase 5 | Pending |
| VITALS-02 | Phase 5 | Pending |
| DIV-02 | Phase 5 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-07-24*
*Last updated: 2026-07-24 after roadmap creation*
