# SLVRline — Overnight Autonomous Build Log

**Started:** 2026-07-24 ~23:10 (local)
**Mode:** Autonomous YOLO — build all 5 phases unattended while the user sleeps.
**Read this first in the morning.** This is the running status report; scroll to the bottom for the latest.

## Ground rules I'm operating under
- ✅ Build, run locally, and commit atomically on branch `nftimm-dev/bozeman`.
- ✅ Validate against live systems (RPC, Goldsky subgraph, Blockscout, Dexscreener — all confirmed reachable).
- 🚫 **No `git push`, no deploy, no external/publishing actions.** Everything stays local + reversible.
- 🧭 Don't stall: where something can't be verified, implement it correctly, label the assumption, and keep moving.

## Environment (verified at start)
- Node 24.11, pnpm 10.30, **PostgreSQL 18 (native)**, Docker 28, 16 cores.
- RPC `rpc.mainnet.chain.robinhood.com` → chainId `0x1237` (4663) ✓
- Goldsky subgraph live (head block 18,424,883) ✓
- Blockscout returns **verified Solidity source** for contracts ✓ (enables real APR-formula derivation)
- Dexscreener token endpoint ✓

## Phase status

| Phase | Status | Notes |
|-------|--------|-------|
| 1 · Indexer Foundation | ◆ In progress | ✅ Research done (APR formula derived) + ✅ scaffold proven (Ponder→Postgres, 1,008 rows). Planning real indexer next. |
| 2 · Full Contract Coverage | ○ Pending | |
| 3 · Derived Metrics | ○ Pending | |
| 4 · API Layer | ○ Pending | |
| 5 · Frontend | ○ Pending | |

## Running notes (newest at bottom)
- **23:10** — Env verified, all feeds reachable, contracts verified on Blockscout. Kicked off Phase 1: (a) contract-derivation research → `.planning/phases/phase-1/RESEARCH.md` (incl. the Dividends APR formula), and (b) repo scaffold (Ponder + local Postgres 18 + token skeleton).
- **23:30** — Both landed. **Scaffold proven:** Ponder connects to live RPC, backfilled 1,008 SLVR Transfer rows into Postgres (`postgresql://timwilliams@localhost:5433/slvrline`), reached head, follows live. codegen + tsc pass. Committed `797f082`. **Research complete** (all 7 contracts verified on Blockscout, ABIs saved). Key ground truth:
  - **Dividends APR** = `(minerIndex(t) − minerIndex(t−7d))/1e18 × (31,536,000/604,800)`. `minerIndex` = on-chain cumulative dividend paid per 1 unclaimed SLVR (WAD), and it's a **10% "refining fee" inside the Grid Lottery**, not the Hub. eth_call value matched the subgraph exactly. Recent level ~1,228% (7-day) — genuinely high because the protocol is ~15 days old; label as "early" until ≥7 days of V2 data. Formula = exact; magnitude = re-validate in Phase 3.
  - **Migration is NOT a clean handoff:** V1 resolved rounds 0→13,122, V2 resolved 12,370→14,224; ~740 rounds exist on both. Fixed model: index both in full, attribute canonically by round# at 12,500, key by `(chain_id,address,tx_hash,log_index)`. Roadmap SC corrected.
  - Deploy blocks: SLVR token **5,574,774**; GridLottery V1 **5,649,104**, V2 **16,764,101**; Hub **5,574,804**. Round 12,500 resolved on V2 at block 16,881,792.
  - Other corrections captured for later phases: emissions = `Transfer` from 0x0 (no dedicated mint event) — don't also sum Hub `RewardMinted`; permanent veSLVR locks burn underlying SLVR; veNFT has no `supply()` (sum `locks[].amount`). Roadmap Phase 2 SC corrected.
  - Next: plan Phase 1 real indexer (SLVR token from block 5,574,774 + both Grid Lottery contracts, migration-safe schema) → execute → verify vs subgraph.
