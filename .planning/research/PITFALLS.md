# Pitfalls Research

**Domain:** Self-hosted EVM indexer + crypto protocol analytics dashboard (SLVRline / SLVR on Robinhood Chain)
**Researched:** 2026-07-24
**Confidence:** HIGH for indexing and numeric correctness pitfalls (well-documented in EVM tooling literature); MEDIUM for SLVR-specific tokenomics pitfalls (derived from protocol structure in PROJECT.md + general DeFi analytics patterns); LOW for Robinhood Chain-specific RPC behavior (obscure chain, limited public documentation)

---

## Critical Pitfalls

### Pitfall 1: Round-12,500 Migration Double-Count / Missing-Rounds Trap

**What goes wrong:**
The Grid Lottery migrated from the old contract (`0x284Eb4016305Fa7FbC162Fb68F27227271001c7f`) to the current contract (`0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71`) at round 12,500, cutover timestamp 2026-07-23 01:09:24 UTC. If both contracts are indexed without a hard split at exactly round 12,500, one of two catastrophic errors occurs:

- **Double-count**: Rounds that were finalized on the old contract and also re-emitted on the new contract get counted twice, inflating round totals, jackpot history, bets, and any derived Dividends APR.
- **Missing rounds**: If the indexer only starts from the new contract's deployment block and ignores the old contract's history, all pre-12,500 rounds disappear. Emissions, cumulative bets, historical APR charts, and jackpot history will be wrong from the start.

**Why it happens:**
Indexers are usually configured per-contract, not per-round-number. The natural instinct is to add both contract addresses and index their full event histories independently — but the two contracts share a logical round counter, so events from both will exist for rounds in the overlap window.

**How to avoid:**
- Index the old contract from its deployment block **up to and including** the block containing round 12,500's resolution event (not the cutover timestamp, but the specific block — derive from the Blockscout explorer or contract event log).
- Index the new contract **from that same block + 1** onward.
- The split boundary is the `block_number` of the last event in the old contract for round 12,500, not a wall-clock timestamp. Timestamps have ~2-hour tolerance on-chain and are unsafe as boundaries.
- Store a `contract_address` column on every indexed event. When aggregating rounds, use the round number as the key but enforce the contract boundary: old-contract events are canonical for rounds < 12,500 and new-contract events are canonical for rounds >= 12,500.
- Write a validation query at index completion: assert zero overlapping round numbers across both contract addresses.

**Warning signs:**
- Round count totals don't match the slvr.fun frontend or the Goldsky subgraph.
- Dividends APR is double the expected value for the historical period.
- Cumulative bets chart has a visible spike or drop at the migration date.
- Any chart time series shows a discontinuity at 2026-07-23.

**Phase to address:**
Indexer foundation phase (before any metrics are computed). The split logic must be in the initial schema and backfill plan — it cannot be retrofitted after data is loaded. Write the validation query before the first production backfill.

---

### Pitfall 2: Float Arithmetic for 18-Decimal Token Amounts

**What goes wrong:**
SLVR has 18 decimal places. Raw token amounts are `uint256` values that can reach `500000 * 10^18` (500,000 SLVR in wei-equivalent units). JavaScript's native `number` type is IEEE 754 double precision with 15-16 significant decimal digits. A balance of `500000000000000000000000` (500k SLVR in raw units) has 24 digits — 8 digits beyond what `number` can represent without rounding error. Any arithmetic done with `number` on raw amounts will silently produce wrong results.

Specific failure modes:
- `Number(rawAmount)` truncates or rounds values greater than `2^53 - 1` (~9 quadrillion), which is less than 10 SLVR in raw units (`10 * 10^18 = 10^19`).
- Division to convert to display units (divide by `10^18`) before all arithmetic means precision is lost during intermediate steps.
- Cumulative sums (total emissions, total bets over all rounds) compound the error across thousands of additions.

**Why it happens:**
Developers familiar with JavaScript write `const amount = parseInt(rawValue) / 1e18` as a quick conversion. This is correct for display only. Storing the result in the database as a float and later re-aggregating it reintroduces float error into every derived metric.

**How to avoid:**
- Store all raw token amounts in the database as `NUMERIC` (Postgres) or `TEXT` (SQLite), never as `FLOAT8`/`DOUBLE`. NUMERIC is arbitrary precision.
- Do all arithmetic in BigInt (JavaScript) or a BigDecimal library (e.g., `viem`'s `formatUnits`, or `bignumber.js`) before converting to display strings.
- The display-layer conversion (divide by `10^18`) happens exactly once, as late as possible, for human-readable rendering only.
- For the API response, return raw amounts as strings and let the frontend format them.
- Write a unit test: sum 1,000 transfers of `12345678901234567890` and assert the result matches the BigInt total.

**Warning signs:**
- Circulating supply shows 500,000.000000000... with recurring trailing digits that don't match on-chain.
- Dividends APR changes by 0.0001% when small dust transfers happen.
- Total emissions in the database doesn't match `totalSupply()` queried directly from the contract.
- Any cumulative sum diverges from a fresh `eth_call` to the contract's state.

**Phase to address:**
Indexer foundation (schema design). Fix before first byte of data is stored. A float schema requires a complete re-migration to fix.

---

### Pitfall 3: Non-Idempotent Event Processing Causing Duplicate Records

**What goes wrong:**
The indexer will run backfills, recover from crashes, and re-process ranges after detected gaps. Without idempotency, each re-run inserts duplicate rows. Duplicate lottery bets inflate round totals; duplicate emissions inflate supply; duplicate transfer events corrupt balance histories. The error is silent — no exception is raised, numbers are simply wrong.

**Why it happens:**
INSERT queries without conflict handling are the default in most databases. Developers test happy-path backfill (run once on a clean DB) and never test re-run scenarios.

**How to avoid:**
- Primary key for every event table must be `(chain_id, block_number, transaction_hash, log_index)`. This is globally unique for any EVM log event.
- All inserts use `INSERT ... ON CONFLICT DO NOTHING` (Postgres) or `INSERT OR IGNORE` (SQLite). Never bare `INSERT`.
- For derived/aggregate tables (e.g., per-round totals, per-epoch APR), use `UPSERT` (`ON CONFLICT DO UPDATE`) rather than `DELETE + INSERT`.
- Test by running the same block-range backfill twice and asserting row counts are identical on both runs.
- Add a `last_indexed_block` checkpoint table so the indexer knows where to resume, preventing overlapping ranges on restart.

**Warning signs:**
- Total bets count grows each time the indexer restarts.
- Running the backfill twice produces different row counts.
- Any aggregate (total emissions, total volume) is a round multiple of the correct value (2x, 3x — a telltale sign of duplicate rows).

**Phase to address:**
Indexer foundation. Schema design must include the primary key constraint before the first insert. Cannot be retrofitted without a full re-migration.

---

### Pitfall 4: Ignoring Chain Reorganizations at the Head

**What goes wrong:**
When the indexer processes events near the chain head, those blocks are unfinalized. A chain reorganization replaces them with a different canonical chain. Events the indexer recorded from the orphaned blocks never actually happened. The indexer now holds stale, incorrect state: fictitious bets, phantom token transfers, wrong current supply, wrong current jackpot.

On Robinhood Chain (an EVM L2 settling on a parent chain), the exact finality model is not publicly documented. L2 sequencer confirmations precede L1 settlement. Treating sequencer confirmation as final accepts reorg risk.

**Why it happens:**
Developers building on fast EVM chains assume reorgs don't happen because they're rare. They are rare but not zero. A single missed reorg corrupts live headline numbers that SLVRline promises are correct.

**How to avoid:**
- Configure a finality buffer: do not show headline numbers from blocks less than N blocks behind the current head. Start conservative (N=64) and reduce after observing actual reorg depth on Robinhood Chain using Blockscout's reorg data.
- Alternatively (lower complexity), mark recent blocks as `pending` in the DB and only promote them to `finalized` state once N confirmations have passed. The API filters to finalized only for headline stats; charts can optionally include pending with a clear label.
- Do not track per-block rollback history for v1 (too complex). The simpler approach: detect when the indexer's stored block hash at height H does not match the chain's current block hash at H. If mismatch, roll back to the last known-good checkpoint and re-index forward.
- Log every reorg detection event for monitoring.

**Warning signs:**
- Live APR jumps by a large amount and then immediately corrects.
- A round appears as "complete" and then disappears.
- Block hashes in the DB don't match Blockscout for the same block numbers.

**Phase to address:**
Indexer live-sync phase (after backfill is stable). Configure the finality buffer before going live with headline numbers.

---

### Pitfall 5: Circulating Supply Definition Errors

**What goes wrong:**
"Circulating supply" shows a number that includes SLVR that is not economically circulating: team vesting tokens, growth fund allocation, permanently locked veSLVR positions. This makes supply look larger than it is, making per-token metrics (market cap, emissions rate per token) wrong. Alternatively, over-excluding burns or locked tokens understates supply.

For SLVR specifically, the risk addresses in play:
- **Team vesting** (`0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5`) — locked veNFT, should be excluded.
- **Growth fund** (`0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729`) — growth allocation, exclusion depends on whether it has been deployed.
- **Vote Escrow NFT** (`0xd9b8FBD61033145c5496132153CE675756313B71`) — SLVR locked in veSLVR positions. These are still economic holdings of the lock owner (not destroyed), so they should be counted in circulating supply but tracked separately as "staked/locked." Excluding them entirely would understate supply.
- **Burns** — permanently removed; must be subtracted from total supply.
- **Protocol wallets** — the deployer/admin (`0x11111972FE1b7e52D36609bCaF8702c65b025B46`) and growth recipient (`0x4444479B89b684e79392924B3A70BE03733190dE`) hold SLVR that may or may not be circulating.

**Why it happens:**
"Circulating supply" is undefined in the ERC-20 standard. Every project defines it differently. Analytics developers either use `totalSupply()` (always wrong — includes team allocations), or subtract everything locked (sometimes wrong — over-excludes holder positions), or copy a number from the protocol's own frontend without understanding its methodology.

**How to avoid:**
- Define the methodology explicitly in a `METHODOLOGY.md` or equivalent and display it on the site. Users must be able to audit SLVRline's formula.
- Start from: `totalSupply() - burned_tokens - team_vesting_balance - undeployed_growth_fund_balance`.
- Do NOT subtract veSLVR-locked SLVR from circulating (that SLVR is still owned by lockers, just locked). Track it separately as "staked."
- Verify the formula by calling `balanceOf()` for each exclusion address at a known block and checking the arithmetic against `totalSupply()`.
- Cross-check the result against the Goldsky subgraph and slvr.fun at identical block numbers. Document any discrepancy with an explanation.

**Warning signs:**
- Circulating supply equals totalSupply() — team/burn exclusions are missing.
- Circulating supply is less than staked SLVR — double-exclusion of staked tokens.
- The number changes at every block even when no transfers occur — wrong source data.

**Phase to address:**
Supply metrics phase. Resolve the definition before displaying any supply number. Ship a public methodology page before the number appears on the dashboard.

---

### Pitfall 6: Dividends APR Calculation Errors

**What goes wrong:**
This is SLVRline's headline metric and the most complex. Multiple failure modes exist:

1. **Wrong funding source**: Dividends are funded by other miners, not by protocol emissions. Using total protocol emissions as the numerator overstates APR.
2. **Wrong annualization window**: APR calculated from a 24-hour spike (e.g., a large jackpot payout day) and annualized (`rate_per_day * 365`) produces astronomical, misleading APR figures.
3. **Wrong denominator**: APR is yield on *unclaimed* mining rewards, not on all staked SLVR. Using total staked SLVR as the denominator understates APR for miners who haven't claimed.
4. **Confusing APR with APY**: If the Dividends are compounding (earned dividends can themselves earn dividends before claim), displaying simple APR understates actual yield.
5. **Stale rate**: Annualizing a rate from a window that predates a major protocol parameter change makes the displayed APR wrong for current conditions.

**Why it happens:**
The Dividends mechanic is protocol-specific and not described in any public standard. The formula must be reverse-engineered from the Grid Lottery contract and subgraph. Developers often guess a formula that "looks right" without validating against the contract's internal accounting.

**How to avoid:**
- Before writing any APR calculation code, inspect the Grid Lottery contract's Dividends-related events and functions. Extract the exact fields that represent "dividends paid" vs. "total unclaimed rewards" vs. "protocol emissions."
- Use a 7-day rolling window for APR calculation, not 24 hours. Display the window explicitly ("7-day APR").
- Show a smoothed trend line alongside instantaneous rate so users understand volatility.
- Validate the APR formula against a known-good historical period by manually computing it from raw indexed events and comparing to any APR the official slvr.fun site displays.
- Label clearly: "Dividends APR (7-day rolling)" — never just "APR."
- Flag and suppress display if the window has fewer than N rounds (insufficient data).

**Warning signs:**
- APR exceeds 10,000% — almost certainly a wrong numerator or too-short window.
- APR is 0% on days when the protocol is clearly paying dividends — wrong denominator or wrong event selector.
- APR from SLVRline doesn't match APR displayed on slvr.fun (document the difference if the methodology differs; otherwise investigate).

**Phase to address:**
Metrics computation phase. Do not ship the Dividends APR headline number until it has been validated against at least two weeks of historical data and cross-checked with the official frontend.

---

## Moderate Pitfalls

### Pitfall 7: veNFT / veSLVR Double-Counting

**What goes wrong:**
veSLVR positions are ERC-721 NFTs (`0xd9b8FBD61033145c5496132153CE675756313B71`) where each token ID represents a locked SLVR position. The underlying SLVR is held by the Vote Escrow contract. If the indexer counts:

- SLVR held by the Vote Escrow contract (via `balanceOf(voteEscrowAddress)`) AND
- The nominal SLVR locked in each veNFT (via events or `locked()` calls)

...it counts the same SLVR twice.

Additionally, the veSLVR staking contract (`0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200`) stakes veNFTs (not underlying SLVR). Reporting "SLVR staked in veSLVR staking" requires resolving the veNFT token IDs to their underlying SLVR amounts — one layer of indirection that is easy to short-circuit incorrectly.

Permanently locked positions are a special case: they have no decay schedule and never unlock. They must be reported separately from time-decaying locks because they represent structurally different economic behavior.

**How to avoid:**
- Pick one canonical source for "total SLVR locked in veSLVR": the `totalSupply` of locked SLVR reported by the Vote Escrow contract itself (via `supply()` or equivalent), not a sum of Transfer events into that address.
- Report "permanently locked SLVR" as a separate number by summing `locked()` for positions with `end == type(uint256).max` or equivalent sentinel value.
- Never add `balanceOf(voteEscrowContract)` to any other balance — that's the same SLVR already counted via the veNFT positions.

**Warning signs:**
- Total staked + total unstaked > circulating supply.
- "Permanently locked" amount changes on days when no new permanent locks are created.
- Staked SLVR on veSLVR staking contract exceeds total veSLVR NFT supply (an impossible state that reveals a counting error).

**Phase to address:**
Staking metrics phase. Validate by reconciling: `totalSupply_SLVR = circulating + veSLVR_locked + burned`.

---

### Pitfall 8: Fee-on-Transfer Token Transfer Amount Mismatch

**What goes wrong:**
SLVR has buy/sell tax logic. When SLVR is transferred, the emitted `Transfer` event may log the gross amount (before tax), but the recipient receives less (after tax is deducted and routed to the protocol). An indexer that computes balances by summing `Transfer` events will overcount recipient balances and incorrectly track tax revenue.

This affects:
- Balance history for non-protocol wallets.
- Volume calculations (gross volume from DEX swaps is the pre-tax amount; actual user-received amount is less).
- Any metric that computes "SLVR received by X address."

**How to avoid:**
- Use `balanceOf(address, blockNumber)` via `eth_call` at a specific block for balance tracking, not a sum of Transfer events. Events are the audit trail; on-chain state is the ground truth.
- For volume metrics, explicitly choose whether to report gross (pre-tax) or net (post-tax) volume and label the choice clearly in the UI.
- Do not attempt to compute tax revenue by subtracting net from gross transfers — the routing of tax to the protocol hub (`0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f`) is a separate Transfer event that the indexer should capture directly.

**Warning signs:**
- Sum of all Transfer-in events to an address doesn't match `balanceOf()` at the same block.
- Tax revenue computed from event arithmetic doesn't match what the SLVR Hub contract actually holds.

**Phase to address:**
Indexer foundation. Establish early whether balances will be tracked via events or via periodic `balanceOf` snapshots. Do not mix approaches.

---

### Pitfall 9: Single-RPC Single Point of Failure

**What goes wrong:**
Robinhood Chain is an obscure chain with one known public RPC (`https://rpc.mainnet.chain.robinhood.com`). The protocol also exposes a proxy (`https://slvr.fun/api/rpc`). If the public RPC is down, rate-limited, or slow, the indexer stalls. Live headline numbers freeze. Users see stale data without any indication it is stale.

Compounding the risk: obscure chains often have undocumented rate limits that are enforced inconsistently. The indexer may work fine during development (low query volume) and fail under production backfill (high query volume).

**How to avoid:**
- Implement both endpoints as fallback sources: primary → public RPC, fallback → slvr.fun proxy, fallback → Goldsky subgraph for event data.
- Add retry logic with exponential backoff (not retry-immediately) to all RPC calls.
- Add a circuit breaker: if the primary fails N times in M seconds, promote the fallback and alert.
- Track `last_indexed_block` and expose it as a health endpoint. If `chain_head - last_indexed_block > threshold`, show a staleness banner on the dashboard.
- Use `eth_getBlockByNumber("latest")` as a lightweight heartbeat to detect RPC availability without pulling full data.
- Batch RPC calls using Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11` is deployed on Robinhood Chain) to reduce per-call count and stay within rate limits.

**Warning signs:**
- Indexer processing speed drops to zero for > 5 minutes.
- Dashboard shows the same numbers as 30 minutes ago.
- RPC calls return `429 Too Many Requests` or time out.

**Phase to address:**
Indexer live-sync phase. Implement fallback before first public launch. Backfill can tolerate single-RPC; live sync cannot.

---

### Pitfall 10: Using Spot Price from a Thin Liquidity Pool

**What goes wrong:**
SLVR trades across 16+ markets (per Dexscreener) including Uniswap V2 SLVR/WETH, Uniswap V4 SLVR/ETH, SLVR/USDG, SwapHood V3, SYN/SLVR, and long-tail markets. Spot price from a thin pool is extremely easy to manipulate. A single large swap can move the spot price by 50%+ in a low-liquidity pool. If SLVRline uses spot price from a thin pool, displayed price is misleading and could be trivially gamed to make the dashboard show any price.

The V4 pools add a structural complexity: V4 pool IDs are `bytes32` hashes (not addresses), and the pool state must be queried from the PoolManager contract using the StateView contract. Treating a V4 pool ID as an address will return zero data.

**How to avoid:**
- Use the highest-liquidity pool as the canonical price reference. As of the project brief, this is likely the official Uniswap V2 SLVR/WETH pair (`0xe365b92239097Ed3322131411DbE15a5c4068eff`), but verify by comparing reserve values.
- Use TWAP (time-weighted average price) over at minimum a 30-minute window, not spot price. V2 TWAP is available from the `price0CumulativeLast` / `price1CumulativeLast` accumulators.
- Cross-check spot price against TWAP; if they diverge by > X%, show the TWAP and flag potential manipulation.
- For V4 pool price queries, use the StateView contract (`0xf3334192d15450cdd385c8b70e03f9a6bd9e673b`) with the correct `bytes32` pool ID — not the PoolManager address directly.
- Fetch ETH/USD price from the slvr.fun API (`https://slvr.fun/api/price/eth`) or a secondary oracle and cache it with a TTL — do not re-fetch it on every user request.
- Aggregate Dexscreener's multi-pool response to produce a volume-weighted price across the major pools, rather than picking one arbitrarily.

**Warning signs:**
- Displayed SLVR price is 2-10x different from what users see on official DEX interfaces.
- Price jumps and immediately reverts within the same minute.
- V4 pool price queries return zero.

**Phase to address:**
Market analytics phase. Establish the canonical price methodology before displaying any price. Document the chosen pool and window in the methodology.

---

### Pitfall 11: Backfill Gap Without Detection

**What goes wrong:**
The backfill covers old contract history + new contract history + an ongoing live sync. Any gap in block coverage (e.g., a network error mid-backfill, a range that was skipped due to a timeout) means missing events. Missing lottery round completions causes wrong cumulative totals. Missing Transfer events causes wrong cumulative supply. The indexer has no idea it missed anything, so it reports silently wrong data with full confidence.

**How to avoid:**
- Maintain a `indexed_ranges` table recording every `(from_block, to_block)` range that completed successfully. After backfill, validate that the union of all ranges is gapless from genesis to current head.
- Write a gap-detection job that runs after backfill completion: find any block range not present in `indexed_ranges` and re-queue it.
- Do not assume that "no error was thrown" means "all events were captured." Log the total event count per block range and compare against Blockscout's API for the same range.
- Set block range sizes conservatively (e.g., max 500 blocks per request) to avoid timeouts on the obscure Robinhood Chain RPC.

**Warning signs:**
- Total event count from the indexer doesn't match the total returned by Blockscout's event API for a given contract address.
- Chart time series has flat segments (zero events) in periods where the protocol was clearly active.
- Cumulative emissions don't monotonically increase.

**Phase to address:**
Indexer backfill phase, before going live.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store token amounts as FLOAT8 | Simpler schema, faster early dev | Silent rounding errors in all derived metrics; requires full re-migration to fix | Never |
| Skip idempotency (bare INSERT) | Simpler code | First crash or re-run corrupts all data | Never |
| Read all data from Goldsky subgraph only (no own indexer) | Fastest to ship | Dependent on protocol's own infra; can't validate their numbers independently; v1 core value proposition is lost | Only as bootstrap/cross-check, never as sole source |
| Use spot price, not TWAP, for SLVR price | One line of code vs. accumulator tracking | Displayed price is manipulable and misleading | Display only (clearly labeled as spot), never for derived metrics |
| Hard-code ETH/USD price | No external dependency | Price staleness makes all USD-denominated metrics wrong within hours | Never in production; acceptable in dev/test only |
| Skip finality buffer (index at head with no rollback) | Lower latency | Reorgs silently corrupt live numbers | Never for headline vitals; acceptable for internal monitoring only |
| Ignore the round-12,500 cutover split | One address per indexer table | Double-counted or missing rounds permanently; cannot fix without full re-index | Never |
| Annualize APR from 24-hour window | Real-time responsiveness | Astronomical, misleading APR on high-activity days | Never as the primary displayed value; show as secondary "today's rate" only |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-----------------|
| Goldsky subgraph | Use as sole source of truth | Use as cross-check and bootstrap only; own indexer is authoritative |
| Goldsky subgraph | Assume it handles the round-12,500 split correctly | Audit the subgraph's handling of the migration; it may not split correctly either |
| slvr.fun/api/rpc proxy | Treat as equivalent to the public RPC | It is a third-party proxy; use as fallback only, verify it returns the same block data as the public RPC |
| slvr.fun/api/price/eth | Cache-miss on every request | Cache with a TTL of 60 seconds minimum; this endpoint is a third-party dependency |
| Dexscreener token endpoint | Pick the first result as the price | Dexscreener returns 16+ SLVR markets; select the highest-liquidity pair and volume-weight if aggregating |
| Uniswap V4 StateView | Query using pool ID as if it were an address | V4 pool IDs are `bytes32` (keccak256 of PoolKey struct), not addresses; call StateView with the correct ID format |
| Blockscout API | Use as real-time RPC fallback | Blockscout API has its own indexing latency; use for historical validation and explorer links, not as real-time data source |
| Vote Escrow NFT | Count `balanceOf(voteEscrowContract)` as staked SLVR | That balance IS the locked SLVR; adding it to veNFT position sums double-counts it |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all events in one `eth_getLogs` call for large block ranges | RPC timeout, partial results silently treated as complete | Chunk into max 500-block ranges; track progress | During backfill of 12,500+ rounds of history |
| Computing APR on every API request via a full DB scan | Dashboard load time > 5 seconds | Pre-compute and cache APR in a materialized view or cron job, refresh every 5 minutes | When cumulative events table exceeds ~100k rows |
| Calling `balanceOf()` for every address on every block | Rate limit exceeded on RPC | Batch via Multicall3; only re-fetch on Transfer event for that address | As soon as token holder count exceeds ~50 |
| Fetching Dexscreener API on every dashboard load | Dexscreener 429 errors, slow page | Cache at edge (CDN) or server-side with 60-second TTL | When dashboard has more than ~100 concurrent users |
| Full-table scans for chart time-series | Chart loads take 10+ seconds | Index `(timestamp, metric_name)` on the time-series table; use partitioning by month if volume is high | At ~1 year of history with per-round granularity |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Indexing the jackpot-insurance contract (`0xf9D2540662F48F21364B98240574384Fe88e8F2f`) in v1 | Unverified ABI causes silent parsing errors; wrong data displayed as factual | Explicitly excluded from v1 scope; document the exclusion in the UI |
| Treating any unverified contract's events as authoritative | Misparse malformed events, display wrong numbers | Only index contracts with verified ABIs from Blockscout or the project's official GitHub |
| Displaying metrics with no staleness indicator | Users make decisions on hours-old data thinking it is live | Every headline number must show `last updated: X seconds ago`; show warning if > 2 minutes stale |
| Relying on `block.timestamp` for business logic boundaries | Miners can set timestamps +/- ~15 seconds; L2 timestamps may deviate more | Use block number, not timestamp, for the round-12,500 migration split boundary |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing "APR" without specifying the window | Users assume it is current; it could be a 7-day trailing average from a volatile week | Always show the window: "7-Day APR," "30-Day APR," or "Today's Rate" |
| Showing circulating supply without defining what is excluded | Users dispute the number; community trust erodes | Link to a methodology page from the supply number with a (?) icon |
| Showing 0 or null when the indexer hasn't processed that data yet | Users assume the protocol has no activity | Show a loading state or "Data pending" rather than 0 |
| Showing high-precision numbers (e.g., 47,382.938475920184) for metrics like APR | False precision; APR is estimated, not exact | Round APR to 2 decimal places; supply to nearest integer; price to 4-6 significant figures |
| No indication when the dashboard is showing stale data due to indexer lag | Users trust wrong numbers | Show a staleness banner if `now - last_indexed_block_timestamp > 5 minutes` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Round-12,500 split**: Check that no round number appears in events from both old and new Grid Lottery contract addresses. Run: `SELECT round_number, COUNT(DISTINCT contract_address) as sources FROM lottery_events GROUP BY round_number HAVING COUNT(DISTINCT contract_address) > 1`.
- [ ] **Float precision**: Verify that `SUM(raw_amount)` from the DB matches `totalSupply()` from an `eth_call` at the same block, to the exact wei.
- [ ] **Idempotency**: Run the same block range backfill twice; assert row counts are identical on both runs.
- [ ] **Circulating supply reconciliation**: `totalSupply - burned - team_vesting - undeployed_growth_fund` must equal displayed circulating supply within 1 wei (rounding aside).
- [ ] **Dividends APR validation**: Compute manually from raw events for a known 7-day window; result must match the dashboard display.
- [ ] **Gap detection**: Assert the indexed block ranges cover continuously from contract deployment block to current head with no gaps.
- [ ] **Reorg buffer**: Confirm that headline numbers are not sourced from blocks within the last N (e.g., 64) blocks.
- [ ] **Staleness indicator**: Confirm that if the indexer stops, the dashboard shows a staleness warning within 5 minutes.
- [ ] **V4 pool ID format**: Confirm that price queries to the StateView use the `bytes32` pool ID, not the PoolManager address.
- [ ] **Transfer event amounts vs. balanceOf**: For a sample of addresses, assert that `balanceOf()` matches the net of Transfer events plus any fee adjustments.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Round-12,500 double-count discovered in production | HIGH — full re-index required | Drop and recreate lottery event tables with migration split; re-run backfill from scratch for both contracts; validate with gap + overlap checks |
| Float precision error in existing schema | HIGH — full re-migration | Add NUMERIC columns alongside FLOAT columns; re-compute all amounts; migrate in a single transaction; drop old float columns |
| Non-idempotent inserts with duplicate rows | MEDIUM — targeted deduplication | Run a deduplicate query keyed on `(chain_id, block_number, tx_hash, log_index)`; add ON CONFLICT constraint; verify counts post-dedup |
| Stale APR formula discovered after launch | MEDIUM — formula change + backfill of APR table | Re-compute APR table from raw event data (source events are correct); push corrected values; issue a community notice explaining the correction |
| Indexer gap in historical data | MEDIUM — targeted re-backfill | Use gap-detection query to identify missing ranges; re-backfill those ranges only (idempotency makes this safe); re-run validation |
| Reorg not handled, corrupt live state | LOW (if finality buffer was set) / HIGH (if not) | With finality buffer: rollback to last finalized checkpoint, re-sync from there. Without buffer: identify highest confirmed canonical block from RPC, delete all data after that block, re-sync |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Round-12,500 double-count / missing rounds | Indexer foundation (schema + backfill plan) | Overlap/gap query; row counts match Goldsky subgraph for pre- and post-migration windows |
| Float arithmetic on 18-decimal amounts | Indexer foundation (schema design) | Sum 1000 events in DB; assert equals BigInt sum; assert equals `totalSupply()` eth_call |
| Non-idempotent event processing | Indexer foundation (schema + insert logic) | Double-backfill test; row counts identical on both runs |
| Chain reorganizations at head | Indexer live-sync phase | Introduce a simulated stale block and verify rollback to checkpoint |
| Circulating supply definition | Supply metrics phase | Reconciliation formula: totalSupply - excluded = circulating; cross-check against slvr.fun |
| Dividends APR errors | Metrics computation phase | Manual APR calculation from raw events for a 7-day window; must match dashboard ±0.1% |
| veNFT double-counting | Staking metrics phase | Assert: circulating + veSLVR_locked + burned = totalSupply |
| Fee-on-transfer mismatch | Indexer foundation | Sample 10 wallet addresses: net Transfer events must equal balanceOf() at same block |
| Single-RPC single point of failure | Indexer live-sync phase | Disable primary RPC in test; assert fallback activates within 30 seconds |
| Thin liquidity spot price | Market analytics phase | Compare spot vs. TWAP; assert < 5% divergence at any non-manipulation moment |
| Backfill gap without detection | Indexer backfill phase | Gap detection query returns zero rows after backfill |

---

## Sources

**Indexing correctness and reorg handling:**
- [EVM Indexer: Logs, Topics, and ABIs — SQD](https://sqd.dev/learn/what-is-an-evm-indexer/) — MEDIUM confidence (verified with official SQD documentation)
- [Indexing & Reorgs — Envio](https://medium.com/@envio_indexer/indexing-reorgs-326f7b6b13ba) — MEDIUM confidence
- [Chain Reorganization Support — Envio Docs](https://docs.envio.dev/docs/HyperIndex/reorgs-support) — MEDIUM confidence
- [Our approach to indexing EVM blockchain events — Bilinear Labs](https://bilinearlabs.io/blog/indexing-blockchain-events/) — MEDIUM confidence
- [Building a Production-Ready EVM Indexer in Rust — Medium](https://medium.com/@hpraveenmatheesha/building-a-production-ready-evm-indexer-in-rust-a-complete-guide-part-01-246d91bfd910) — LOW confidence (single source)

**Numeric precision:**
- [ERC-20 standard — OpenZeppelin Docs](https://docs.openzeppelin.com/contracts/3.x/erc20) — HIGH confidence
- [batchOverflow Bug in ERC20 Contracts — PeckShield](https://peckshield.medium.com/alert-new-batchoverflow-bug-in-multiple-erc20-smart-contracts-cve-2018-10299-511067db6536) — HIGH confidence (documented CVE)

**Circulating supply methodology:**
- [CoinGecko Supply Methodology](https://support.coingecko.com/hc/en-us/articles/32294647667865-CoinGecko-Supply-Methodology) — HIGH confidence
- [DefiLlama Methodology](https://docs.llama.fi/) — HIGH confidence
- [TVL Calculation Methodology — coinapproved.com](https://coinapproved.com/understanding-tvl-calculation-methodology-a-practical-guide-for-defi) — MEDIUM confidence

**APR calculation:**
- [APR vs APY — Crypto.com](https://crypto.com/us/crypto/learn/what-is-apy-in-crypto) — MEDIUM confidence
- [APR calculation — WEEX Crypto Wiki](https://www.weex.com/wiki/article/how-to-calculate-apr-in-crypto-investments-what-investors-should-know-k7j53hz4vy61u61oucmvmpks) — MEDIUM confidence
- Annualization window risk derived from DeFi analytics community practice — LOW confidence (general knowledge)

**Vote-escrow mechanics:**
- [Curve Voting Escrow Docs](https://docs.curve.finance/curve_dao/voting-escrow/voting-escrow/) — HIGH confidence
- [Velodrome-style veNFT — community literature](https://www.fensory.com/insights/learn/vote-escrow-tokenomics) — MEDIUM confidence

**Uniswap V4 pool IDs:**
- [Uniswap V4 StateView Docs](https://docs.uniswap.org/contracts/v4/guides/state-view) — HIGH confidence (official Uniswap docs)
- [PoolKey And PoolId — Cyfrin Updraft](https://updraft.cyfrin.io/courses/uniswap-v4/pool-manager/pool-key-and-pool-id) — MEDIUM confidence

**Thin liquidity / TWAP:**
- [Uniswap V4 Truncated Oracle — Hacken](https://hacken.io/discover/uniswap-v4-truncated-oracle/) — MEDIUM confidence
- [Uniswap V3 TWAP Market Risk — Chaos Labs](https://chaoslabs.xyz/posts/chaos-labs-uniswap-v3-twap-market-risk) — MEDIUM confidence

**RPC reliability:**
- [Blockchain RPC for AI agents — Chainstack](https://chainstack.com/blockchain-rpc-for-ai-agents/) — MEDIUM confidence
- [Hypersync under load — Envio](https://docs.envio.dev/blog/hypersync-under-load-no-throttling) — MEDIUM confidence

**Robinhood Chain specific behavior:**
- Chain ID 4663 / RPC / Blockscout from PROJECT.md — HIGH confidence (direct project context)
- Reorg depth and finality behavior on Robinhood Chain — LOW confidence (obscure chain; no public documentation found; requires empirical measurement)

---
*Pitfalls research for: SLVRline — self-hosted EVM indexer + SLVR protocol analytics*
*Researched: 2026-07-24*
