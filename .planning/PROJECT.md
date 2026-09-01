# SLVRline

## What This Is

SLVRline is a branded, full-stack analytics platform for the **SLVR** mining protocol on Robinhood Chain (an EVM chain, ID `4663` / `0x1237`). It runs its **own indexer** over the SLVR contracts, stores full history in its own database, computes protocol metrics independently, and serves a polished "silver" analytics website to the whole SLVR community — miners, holders, and traders.

It is **read-only, global protocol analytics for v1** (no wallet connection). The hero is a **vitals strip** of live headline stats (Dividends APR · SLVR staked · supply/runway · price) with **historical time-series charts** below.

## Core Value

The community can trust SLVRline as the **single, independent source of truth for the protocol's vitals** — especially yield (Dividends APR) and supply/runway — computed from our own indexed chain data rather than taken on faith from the protocol's own frontend.

If everything else fails, the headline vitals must be **correct, live, and independently verifiable.**

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- v1 scope. All hypotheses until shipped and validated. -->

**Indexer & data**
- [ ] Index the SLVR production contracts on Robinhood Chain into our own datastore, keyed by `chain_id + address`
- [ ] Preserve full history across lottery generations, splitting events at rounds `12,500` and `33,500` so rounds are neither missed nor double-counted
- [ ] Keep the index current near chain head so "live" headline numbers are fresh
- [ ] Serve computed metrics to the frontend via our own API

**Headline vitals (the strip)**
- [ ] Dividends APR — yield earned by miners who hold *unclaimed* mining rewards (funded by other miners)
- [ ] Total SLVR staked
- [ ] Supply summary (circulating / total / 500k max) and mining runway
- [ ] SLVR price

**Supply analytics**
- [ ] Circulating supply vs. total supply vs. 500,000 max cap
- [ ] Cumulative burns and emissions
- [ ] Mining runway — projected time to fully emit the cap at current emission rate

**Staking analytics**
- [ ] Amount of SLVR staked (veSLVR vote-escrow)
- [ ] Amount **permanently** locked/staked (permanent-lock veSLVR)
- [ ] LP staking (SLVR/WETH LP) totals

**Market analytics**
- [ ] SLVR price, liquidity, and volume (Dexscreener + on-chain DEX pools)

**Grid Lottery (mining) analytics**
- [ ] Round activity, bets, winners, and jackpot state over time

**Historical charts**
- [ ] Time-series charts for the above metric families (dividends APR, supply/emissions/burns, staking, price/volume, rounds)

**Presentation**
- [ ] Distinct, polished "silver" analytics brand identity (DefiLlama/Dune energy, but its own)
- [ ] Live headline numbers up top, historical charts below

### Out of Scope

<!-- Explicit boundaries for v1. Includes reasoning to prevent re-adding. -->

- Wallet connection / personal "your position" dashboards — **deliberate v2 fast-follow**; global stats ship first and are simpler
- Trading / swapping / any write actions — this is a read-only analytics site, not a dApp
- Jackpot-insurance product analytics — source is unverified; excluded from v1 to avoid indexing an untrusted/unstable surface
- Governance actions (voting with veSLVR, etc.) — analytics only, no protocol interaction
- Multi-chain / other tokens — SLVR on Robinhood Chain only

## Context

**Chain & token**
- Chain: Robinhood Chain, ID `4663` / `0x1237`
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com/` (API base `https://robinhoodchain.blockscout.com/api/v2/`)
- SLVR token: `0x791229E3EbD6CFdC3D8157f48722684173C29aD9` — ERC-20, 18 decimals, **500,000 max supply**, with buy/sell tax logic, emissions, burns, and protocol routing

**"Mining" = the Grid Lottery game.** Miners play the lottery; the game emits SLVR. The **Dividends** mechanic pays SLVR to miners who have *not yet claimed* their mining rewards, funded by other miners — SLVRline's headline yield metric (Dividends APR) annualizes this. The exact formula must be derived during research from the Grid Lottery contract + subgraph; it is the trickiest metric.

**Current production contracts (index these):**

| Contract | Address | Purpose |
|---|---|---|
| SLVR token | `0x791229E3EbD6CFdC3D8157f48722684173C29aD9` | ERC-20; supply, tax, emissions, burns, routing |
| Grid Lottery | `0xa1e5213505772B195FD7AE3b4a6b27B58Cf72A3D` | Current mining/game generation: rounds 33,500+ |
| Miner State Vault | `0x2070b4B0c57EaF070CF86cD8321a6054f3D25260` | Permanent unrefined SLVR, dividends, and refining clocks |
| AutoCommit V3 | `0x34DD8699E4E9CB6bBA58e28F0233F6e23CeC0387` | Automated recurring bet plans |
| ClaimLocker V2 | `0x44B3D5b8D31251D49Ca4c88b6a82594947693A5C` | Claims winnings and locks SLVR into vote escrow |
| MultiClaim | `0x740A66fc9201962f39802d924D4C2347cdf823A1` | Batches multiple game claims |
| Drand provider | `0x1F3B0992FaBCF77d4df7Baa416b9185e464d58f3` | Randomness for round resolution |
| Jackpot | `0x24B723e2Da172961F60Cd6a4699654c89D4aC6cd` | Holds/pays the protocol jackpot |
| Game Registry | `0x3942CdA122eF303f47d4509A6Be57736E323cEE4` | Registry/status for all lottery deployments |
| SLVR Hub | `0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f` | Protocol revenue/reward hub |
| Vote Escrow NFT | `0xd9b8FBD61033145c5496132153CE675756313B71` | Locks SLVR, issues veSLVR NFTs |
| veSLVR staking | `0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200` | Stakes veSLVR, distributes protocol revenue |
| LP staking | `0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA` | Stakes SLVR/WETH V2 LP tokens |
| Team vesting | `0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5` | Team allocation (locked veNFT) |
| Growth fund | `0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729` | Growth allocation + revenue routing |
| veSLVR metadata | `0x4ba36b684350471c6fA03f4EBdEF9120496db45F` | On-chain veSLVR NFT metadata renderer |
| Liquidity Zap | `0x85b10820F5b7Ef2bbF9F5B59dA64860DD6bFb9F0` | Adds SLVR/WETH liquidity, optionally stakes LP |
| Jackpot insurance | `0xf9D2540662F48F21364B98240574384Fe88e8F2f` | Insurance tickets — **unverified source, out of scope v1** |

**DEX / network dependencies:**

| Contract | Address |
|---|---|
| Official SLVR/WETH V2 pair | `0xe365b92239097Ed3322131411DbE15a5c4068eff` |
| Uniswap V2 router | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` |
| Uniswap V2 factory | `0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Uniswap V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| Uniswap V4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Uniswap V4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| Uniswap V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |

**Historical / inactive contracts (preserve for historical analytics).** Lottery generations changed at rounds `12,500` and `33,500`:

| Contract | Address | Status |
|---|---|---|
| Previous Grid Lottery | `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71` | Gas-optimized generation, rounds 12,500–33,499 |
| Original Grid Lottery | `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f` | Original generation, rounds 0–12,499 |
| Genesis game | `0x8C756b6738bdd687c3376C748C63419be0412FDd` | Retired; unverified |
| AutoCommit V1 | `0x1399115FcF2a9C41e5080547A9214156A4Bf8a45` | Superseded |
| AutoCommit V3 (previous) | `0x5FD69EE67472495CDc0BE784898647782E073Ff5` | Superseded at round 33,500 |
| AutoCommit V2 | `0x314c8D5755468224AC60c36FB5494F0D7D5Abb3B` | Superseded |
| ClaimLocker V2 (previous) | `0x83F84C5d431a986a1AB209F902B954b5D3550d8c` | Superseded at round 33,500 |
| ClaimLocker V1 | `0x2fD3BE762eb9d8eE293dD923D8809Dbd3D653dd7` | Superseded |
| MultiClaim (previous) | `0x9F34a8561f97E388D4A1589c1D046C61d6915323` | Superseded at round 33,500 |
| MultiClaim V1 | `0x32783f1301147f6fb45c049a9546819655F81415` | Superseded |
| Liquidity Zap V1 | `0x2674BCcea310b1Fa96D9a6c6E156aF83709a41D6` | Superseded |
| Unactivated lottery candidate | `0xC805B8f8Dd2ee4Ab70d2Ef52503A6C2bB0A97b5f` | Registry `Pending` |
| Candidate ClaimLocker V2 | `0x64e087f48C6968c9127B5d8db03281b820a7ee6C` | Never production |
| Candidate MultiClaim | `0x07e2b7311b99c90BFD7844A0c9dF11Dc27D4bEeF` | Never production |
| Candidate AutoCommit V3 | `0x6D56728Ed5B48c0899F951B5A5a7F61B2e0417ef` | Never production |
| Early AutoCommit-like helper | `0xE537bC279E1a327475694fC676f621624780BCF2` | Obsolete; unverified |
| Early claim-helper-like contract | `0x1092b422c0C688b65bF59F60Dbf1DE7Fa33d1969` | Obsolete; unverified |

**Data feeds (reference / cross-check / bootstrap):**
- Core Goldsky subgraph: `https://api.goldsky.com/api/public/project_cmre158qbffn101xe929tflsk/subgraphs/slvr-robinhood/1.7.0/gn`
- Insurance subgraph: `https://api.goldsky.com/api/public/project_cmre158qbffn101xe929tflsk/subgraphs/slvr-insurance/1.1.0/gn`
- Official RPC proxy: `https://slvr.fun/api/rpc`
- Subgraph proxy: `https://slvr.fun/api/subgraph`
- Round-state endpoint: `https://slvr.fun/api/round-state`
- ETH price endpoint: `https://slvr.fun/api/price/eth`
- Dexscreener token endpoint (query dynamically for long-tail pools): `https://api.dexscreener.com/latest/dex/tokens/0x791229E3EbD6CFdC3D8157f48722684173C29aD9` (~16 SLVR markets currently)
- Official protocol site: `https://slvr.fun/`

**Key non-contract actors (label separately in the index):**
- Protocol deployer/admin/team/revenue wallet: `0x11111972FE1b7e52D36609bCaF8702c65b025B46`
- Growth recipient wallet: `0x4444479B89b684e79392924B3A70BE03733190dE`

**Other markets:** Main Uniswap V4 SLVR/ETH pool ID `0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3`; SLVR/USDG pool ID `0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a` (V4 pool IDs are `bytes32`, not addresses). Also SwapHood V3 SLVR/WETH `0x83A4E4b661935c3914A8fE51B06B0efEf7Ff2962` and SYN/SLVR V2 `0xCA236220176A5811F65d142016af232662aDade0`.

## Constraints

- **Data integrity**: Metrics must be independently computed from indexed chain data and correct. The 500k cap, round-12,500 and round-33,500 migration splits, permanent-vault state, and `chain_id + address` keying are hard correctness requirements.
- **Freshness**: Headline numbers must feel live (indexer keeps up near chain head); historical charts can tolerate slightly higher latency.
- **Tech stack**: Not yet decided — research will recommend the indexer framework, datastore, API, and frontend stack. No strong constraint imposed by the user beyond "sensible defaults."
- **Read-only**: The site never signs transactions or interacts with the protocol; it only reads and displays.

## Key Decisions

<!-- Decisions that constrain future work. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build our own indexer + datastore (vs. only reading the existing Goldsky subgraph) | Custom metrics, full history, and independence from the protocol's own infra; the existing subgraph remains a reference/cross-check and possible bootstrap | — Pending |
| Global-only analytics for v1; wallet-connect deferred to v2 | Ships faster and simpler; personal dashboards are additive | — Pending |
| Its own "silver" brand identity (not a clone of slvr.fun) | Independent source-of-truth positioning; DefiLlama/Dune-class analytics feel | — Pending |
| Split lottery events at rounds 12,500 and 33,500; key by `chain_id + address` | Prevents missing/double-counted rounds across contract generations; miner state moves to the permanent vault at the second cutover | — Pending |
| Exclude jackpot-insurance analytics from v1 | Contract source unverified; avoid indexing an untrusted surface | — Pending |
| Hero = a vitals strip of live headline stats, charts below | User wants an at-a-glance protocol health view that's screenshot-worthy | — Pending |

---
*Last updated: 2026-09-01 after the round-33,500 Miner State Vault migration*
