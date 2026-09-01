# SLVRline Dividends APR Methodology

**Requirement:** DIV-01

**Updated:** 2026-09-01 (round-33,500 Miner State Vault migration)

**Status:** Live formula and state routing verified against deployed source and archival chain reads.

## 1. Headline formula

```text
APR = (minerIndex(t) - minerIndex(t - W)) / 1e18
      * (31,536,000 / W)

W = 86,400 seconds (trailing 24 hours)
```

`minerIndex` is cumulative refining dividends earned per 1e18 unclaimed SLVR,
itself WAD-scaled. Its delta is therefore the exact fractional return earned by
a continuously unclaimed position during the window. No separate pool-size
denominator is needed.

The first 24 hours of a new accumulator return `dataStatus = "early"` and no
APR. Once mature, the headline always uses a complete trailing-24h window.

## 2. Live miner-state source

Miner state no longer lives in the current lottery. From round 33,500 onward it
lives permanently in `SlvrMinerVault`:

| Contract | Address | Role |
|---|---|---|
| SlvrMinerVault | `0x2070b4B0c57EaF070CF86cD8321a6054f3D25260` | Live unrefined balances, dividends, refining clocks, and global index |
| Current Grid Mining | `0xa1e5213505772B195FD7AE3b4a6b27B58Cf72A3D` | Rounds 33,500+; writes rewards into the vault |
| Gas-optimized lottery | `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71` | Historical rounds 12,500-33,499 and legacy balances |
| Original lottery | `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f` | Historical rounds 0-12,499 and legacy balances |

The vault was deployed at block `35,594,698`. Its accumulator is independent
of both lottery-era accumulators. Never subtract index values across a reset.

Confirmed selectors:

| Getter | Selector |
|---|---|
| `minerIndex()` | `0x9806b4d2` |
| `totalUnclaimed()` | `0xc96f14b8` |
| `totalRefined()` | `0x9ff953a0` |
| `getMinerState(address)` | `0xe8fd1cb9` |
| `reserved()` | `0xfe60d12c` |

Vault `getMinerState` returns:

```solidity
(uint256 rewardsSlvr, uint256 indexSnapshot,
 uint256 refinedAccrued, uint64 refineClock)
```

This order differs from the legacy lottery getter and must not be decoded with
the old tuple layout.

## 3. What funds dividends

When a miner cashes out unrefined SLVR, the refining fee is redistributed to
other miners who remain unclaimed. In the current fee calculator the fee starts
at 20% for fresh rewards and decays to 10% over 24 hours using the position's
stake-weighted refining clock. Dividends themselves are not taxed.

The redistributed share increments `minerIndex`; a miner's uncheckpointed
dividends are:

```text
rewardsSlvr * (minerIndex - indexSnapshot) / 1e18
```

plus any already checkpointed `refinedAccrued`.

This metric excludes protocol emissions, veSLVR ETH rewards, token taxes,
Payload prizes, and buybacks. It measures only SLVR refining-fee yield earned by
unclaimed miner positions.

## 4. Pool and per-miner reconciliation

The vault exposes an exact accounting invariant:

```text
totalUnclaimed = reserved + SUM(all miner rewardsSlvr)
```

`reserved` is emitted SLVR delivered for resolved rounds but not yet attributed
to a winner. Attribution happens when the winner claims that round. The mining
rankings enumerate candidate miner addresses, read every state directly at one
chain block through Multicall3, and refuse to publish if the raw-unit invariant
does not match exactly.

## 5. Historical routing

`computeHistoricalAprForBlock` selects one accumulator per sample:

| Sample block | State source | Window clamp |
|---|---|---|
| `< 16,764,101` | Original lottery (legacy archival workflows only) | Its deploy block |
| `16,764,101-35,594,697` | Gas-optimized lottery | Block `16,764,101` |
| `>= 35,594,698` | SlvrMinerVault | Block `35,594,698` |

The live `computeDividendsApr` path always uses the vault. The public APR chart
starts after the vault's first complete 24-hour window so it cannot visually
stitch the retired V2 index to the new accumulator.

## 6. Data sources and checks

- Both window-boundary values are archival `eth_call` reads from the selected
  state contract.
- The current vault index is compared across both configured Robinhood Chain RPC
  paths on every metrics run.
- Per-miner candidate addresses use the protocol's event index plus a raw-log
  tail from the indexer's exact head to chain head. All displayed balances are
  re-read directly from the vault and checked against its raw-unit invariant.
- Annualized APR is a backward-looking rate, not a promise of future returns.
