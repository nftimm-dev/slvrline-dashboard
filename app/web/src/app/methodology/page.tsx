import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import MetricSection from "@/components/methodology/MetricSection";
import ContractTable from "@/components/methodology/ContractTable";
import AddressLabel from "@/components/common/AddressLabel";

export const metadata: Metadata = {
  title: "Methodology — SLVRline",
  description:
    "How every number on SLVRline is computed — formulas, data sources, and contract addresses for SLVR protocol analytics.",
};

export default function MethodologyPage() {
  return (
    <main className="py-10">
      <PageContainer>
        {/* Header */}
        <div className="mb-10">
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "var(--color-silver-100)",
              marginBottom: 8,
            }}
          >
            Methodology
          </h1>
          <p style={{ color: "var(--color-silver-400)", fontSize: "1rem" }}>
            How every number on SLVRline is computed.
          </p>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-silver-400)",
              marginTop: 8,
            }}
          >
            All metrics are computed independently from indexed Robinhood Chain
            data — not taken from slvr.fun or any other source. Cross-checks
            use the{" "}
            <a
              href="https://api.goldsky.com/api/public/project_cm5i6t6d7q2a201ur2tttbyvs/subgraphs/slvr-mainnet-subgraph/1.0.1/gn"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              Goldsky subgraph
            </a>{" "}
            and{" "}
            <a
              href="https://robinhoodchain.blockscout.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              Blockscout Explorer
            </a>
            .
          </p>
        </div>

        {/* Section 1: Dividends APR */}
        <MetricSection title="Dividends APR">
          <div>
            <p style={{ color: "var(--color-silver-300)", fontSize: "0.875rem", marginBottom: 12 }}>
              The annualized yield earned by miners who hold <em>unclaimed</em>{" "}
              SLVR mining rewards in the Grid Lottery. Funded by a 10% refining
              fee on every miner&apos;s claim — redistributed to all remaining
              unclaimed holders.
            </p>

            <div className="mb-4">
              <div
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--color-silver-400)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Core Formula
              </div>
              <pre
                style={{
                  backgroundColor: "var(--color-silver-900)",
                  border: "1px solid var(--color-silver-800)",
                  borderRadius: "var(--radius-card)",
                  padding: "12px 16px",
                  fontSize: "0.8125rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-apr)",
                  overflowX: "auto",
                  lineHeight: 1.6,
                }}
              >
                <code>{`APR = ( minerIndex(t) − minerIndex(t − W) ) / 1e18 × ( 31,536,000 / W )

W = min(604800, contract_age_seconds_at_t)
  = 7-day cap, clamped to contract age

Annualization: Δindex / 1e18 × 52.18   (52.18 = weeks/year)`}</code>
              </pre>
            </div>

            <dl
              className="flex flex-col gap-2"
              style={{ fontSize: "0.8125rem" }}
            >
              <div className="flex gap-2">
                <dt
                  className="font-mono"
                  style={{
                    color: "var(--color-silver-400)",
                    minWidth: 140,
                    flexShrink: 0,
                  }}
                >
                  minerIndex
                </dt>
                <dd style={{ color: "var(--color-silver-300)" }}>
                  Global cumulative refining fee per 1 unclaimed SLVR,
                  WAD-scaled (1e18 = 1.0). Selector:{" "}
                  <code
                    className="font-mono"
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-apr)",
                      backgroundColor: "var(--color-silver-800)",
                      padding: "1px 4px",
                      borderRadius: 3,
                    }}
                  >
                    0x9806b4d2
                  </code>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt
                  className="font-mono"
                  style={{
                    color: "var(--color-silver-400)",
                    minWidth: 140,
                    flexShrink: 0,
                  }}
                >
                  W
                </dt>
                <dd style={{ color: "var(--color-silver-300)" }}>
                  min(604,800s, contract_age_seconds) — 7-day cap, shrinks to
                  actual contract age while &lt; 7 days. Labeled
                  &quot;early&quot; when W &lt; 7d.
                </dd>
              </div>
              <div className="flex gap-2">
                <dt
                  className="font-mono"
                  style={{
                    color: "var(--color-silver-400)",
                    minWidth: 140,
                    flexShrink: 0,
                  }}
                >
                  31,536,000
                </dt>
                <dd style={{ color: "var(--color-silver-300)" }}>
                  Seconds per year (365 days). Annualization constant.
                </dd>
              </div>
            </dl>
          </div>

          {/* Early/caveat box */}
          <div
            style={{
              backgroundColor: "rgba(240,192,80,0.08)",
              border: "1px solid rgba(240,192,80,0.25)",
              borderRadius: "var(--radius-card)",
              padding: "12px 16px",
            }}
          >
            <div
              style={{
                fontSize: "0.6875rem",
                fontWeight: 700,
                color: "var(--color-stale)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              Early / High Magnitude Caveat
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
              V2&apos;s <code className="font-mono" style={{ fontSize: "0.75rem" }}>minerIndex</code>{" "}
              accumulator reset to 0 at block 16,764,101 (2026-07-22). The current
              window W is clamped to ~2–3 days instead of 7, so annualizing a
              short window amplifies any variation. The formula is mechanically
              exact — but yields of 30,000%+ reflect early/volatile conditions on
              a small pool (~495 SLVR unclaimed), not steady-state returns.
              The standard 7-day window becomes available ~2026-07-29.
            </p>
          </div>

          {/* V1/V2 discontinuity */}
          <div>
            <div
              style={{
                fontSize: "0.6875rem",
                color: "var(--color-silver-400)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              V1 → V2 Migration (block 16,764,101)
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
              GridLotteryV1 and GridLotteryV2 maintain <strong>separate,
              independent</strong> <code className="font-mono" style={{ fontSize: "0.75rem" }}>minerIndex</code>{" "}
              accumulators. Do not stitch V1 and V2 index values — the delta
              APR within each contract is meaningful; the cross-contract delta
              is not. Historical charts show a visible reset at block 16,764,101;
              this is correct and expected.
            </p>
            <div
              className="overflow-x-auto mt-3"
              style={{ borderRadius: "var(--radius-card)" }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.75rem",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "var(--color-silver-900)" }}>
                    {["Sample block", "Active contract", "Window start clamped to"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "8px 12px",
                          textAlign: "left",
                          color: "var(--color-silver-400)",
                          borderBottom: "1px solid var(--color-silver-800)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--color-silver-800)" }}>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)", fontFamily: "var(--font-mono)", fontSize: "0.6875rem" }}>
                      &lt; 16,764,101
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)" }}>GridLotteryV1</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)", fontFamily: "var(--font-mono)", fontSize: "0.6875rem" }}>
                      max(V1 deploy, block − 7d)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)", fontFamily: "var(--font-mono)", fontSize: "0.6875rem" }}>
                      &gt;= 16,764,101
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)" }}>GridLotteryV2</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-silver-300)", fontFamily: "var(--font-mono)", fontSize: "0.6875rem" }}>
                      max(16,764,101, block − 7d)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Live contract (V2)
              </div>
              <AddressLabel
                address="0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71"
                showFull
              />
            </div>
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Historical contract (V1)
              </div>
              <AddressLabel
                address="0x284Eb4016305Fa7FbC162Fb68F27227271001c7f"
                showFull
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Cross-check
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-300)" }}>
              Index values verified against{" "}
              <a
                href="https://api.goldsky.com/api/public/project_cm5i6t6d7q2a201ur2tttbyvs/subgraphs/slvr-mainnet-subgraph/1.0.1/gn"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-accent)", textDecoration: "none" }}
              >
                Goldsky subgraph
              </a>{" "}
              <code className="font-mono" style={{ fontSize: "0.75rem" }}>minerIndexUpdateds[0].newIndex</code>.
              Confirmed exact match: <code className="font-mono" style={{ fontSize: "0.75rem" }}>1789282914952366881</code>.
            </p>
          </div>
        </MetricSection>

        {/* Section 2: Total SLVR Staked */}
        <MetricSection title="Total SLVR Staked">
          <p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
            On-chain sum of every <em>active</em> veSLVR vote-escrow lock
            (permanent + time-locked). We enumerate all lock NFTs, read each
            lock&apos;s current state directly from the contract, and sum the
            live amounts — withdrawn or converted locks read zero and drop out
            automatically. Broken down into permanent locks (never unlock) vs.
            time-decaying locks.
          </p>

          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Formula
            </div>
            <pre
              style={{
                backgroundColor: "var(--color-silver-900)",
                border: "1px solid var(--color-silver-800)",
                borderRadius: "var(--radius-card)",
                padding: "12px 16px",
                fontSize: "0.8125rem",
                fontFamily: "var(--font-mono)",
                color: "var(--color-staking)",
                overflowX: "auto",
                lineHeight: 1.6,
              }}
            >
              <code>{`tokenIds     = every ve lock ever minted   (ERC-721 Transfer from 0x0)
for each id: (amount, lockStart, lockEnd, permanent, …) = locks(id)
total_staked = Σ amount   where amount > 0            (active locks only)
permanent    = Σ amount   where permanent OR lockEnd = 0
timelocked   = total_staked − permanent`}</code>
            </pre>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-400)", marginTop: 8, lineHeight: 1.6 }}>
              Reading current on-chain state (rather than replaying events)
              means withdrawals and permanent-conversions are handled for free.
              Permanent locks <em>burn</em> the underlying SLVR, so their amount
              also appears in the &ldquo;emitted&rdquo; figure below.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Vote Escrow NFT
              </div>
              <AddressLabel address="0xd9b8FBD61033145c5496132153CE675756313B71" showFull />
            </div>
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                veSLVR Staking
              </div>
              <AddressLabel address="0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200" showFull />
            </div>
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                LP Staking
              </div>
              <AddressLabel address="0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA" showFull />
            </div>
          </div>
        </MetricSection>

        {/* Section 3: Circulating Supply */}
        <MetricSection title="Circulating Supply + Emitted">
          <p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
            <strong>Circulating</strong> is on-chain{" "}
            <code className="font-mono" style={{ fontSize: "0.75rem" }}>totalSupply()</code>{" "}
            minus tokens held in exclusion addresses (team vesting, growth
            fund). <strong>Emitted</strong> is the true total ever minted from
            the 500,000 hard cap:{" "}
            <code className="font-mono" style={{ fontSize: "0.75rem" }}>totalSupply()</code>{" "}
            <em>plus cumulative burns</em>. Permanent ve-locks burn the
            underlying SLVR, so a large amount that was emitted from the budget
            no longer shows up in <code className="font-mono" style={{ fontSize: "0.75rem" }}>totalSupply()</code>.
            Measuring cap progress by <code className="font-mono" style={{ fontSize: "0.75rem" }}>totalSupply()</code>{" "}
            alone would understate it.
          </p>

          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Formula
            </div>
            <pre
              style={{
                backgroundColor: "var(--color-silver-900)",
                border: "1px solid var(--color-silver-800)",
                borderRadius: "var(--radius-card)",
                padding: "12px 16px",
                fontSize: "0.8125rem",
                fontFamily: "var(--font-mono)",
                color: "var(--color-supply)",
                overflowX: "auto",
                lineHeight: 1.6,
              }}
            >
              <code>{`circulating    = totalSupply() − balanceOf(teamVesting) − balanceOf(growthFund)
cumulativeBurned = Σ value of Transfer(to = 0x0) on the SLVR token
emitted        = totalSupply() + cumulativeBurned      (total ever minted)
emitted_pct    = emitted / 500,000                     (progress toward cap)
max_supply     = 500,000 SLVR (hard cap)`}</code>
            </pre>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-400)", marginTop: 8, lineHeight: 1.6 }}>
              The vitals &ldquo;% mined / 500K&rdquo; progress bar uses{" "}
              <code className="font-mono" style={{ fontSize: "0.75rem" }}>emitted_pct</code>,
              not <code className="font-mono" style={{ fontSize: "0.75rem" }}>totalSupply / cap</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                SLVR Token
              </div>
              <AddressLabel address="0x791229E3EbD6CFdC3D8157f48722684173C29aD9" showFull />
            </div>
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Team Vesting (excluded)
              </div>
              <AddressLabel address="0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5" showFull />
            </div>
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Growth Fund (excluded)
              </div>
              <AddressLabel address="0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729" showFull />
            </div>
          </div>
        </MetricSection>

        {/* Section 4: Mining Runway */}
        <MetricSection title="Mining Runway">
          <p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
            Projected months until the 500,000 SLVR emission budget is exhausted,
            based on <strong>gross</strong> emission. Because burns (mostly
            permanent ve-locks) currently exceed mints, <em>net</em> supply
            change is negative and would give a meaningless runway — so we
            measure how fast SLVR is <em>minted</em> out of the budget, against
            how much of the budget is <em>emitted</em> (not just current supply).
          </p>

          <div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Formula
            </div>
            <pre
              style={{
                backgroundColor: "var(--color-silver-900)",
                border: "1px solid var(--color-silver-800)",
                borderRadius: "var(--radius-card)",
                padding: "12px 16px",
                fontSize: "0.8125rem",
                fontFamily: "var(--font-mono)",
                color: "var(--color-supply)",
                overflowX: "auto",
                lineHeight: 1.6,
              }}
            >
              <code>{`emitted(t)     = totalSupply(t) + cumulativeBurned(t)
remaining      = 500,000 − emitted(now)
window         = [ max(genesis, now − 30d), now ]
grossEmitted   = emitted(now) − emitted(window_start)   (SLVR minted in window)
perDayGross    = grossEmitted / window_days
runway_months  = remaining / perDayGross / 30.44`}</code>
            </pre>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-400)", marginTop: 8, lineHeight: 1.6 }}>
              If <code className="font-mono" style={{ fontSize: "0.75rem" }}>perDayGross ≤ 0</code>{" "}
              the estimate is withheld (insufficient data).
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Emission source (V2)
              </div>
              <AddressLabel address="0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" showFull />
            </div>
          </div>
        </MetricSection>

        {/* Section 5: SLVR Price + Liquidity */}
        <MetricSection title="SLVR Price + Liquidity">
          <p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)", lineHeight: 1.6 }}>
            SLVR/USD price and liquidity sourced from{" "}
            <a
              href="https://dexscreener.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              Dexscreener API
            </a>{" "}
            (server-side proxied, not on-chain). Aggregated across all
            Dexscreener-indexed pools for the SLVR token on Robinhood Chain.
            ETH/USD price from slvr.fun price API.
          </p>

          <div className="flex flex-wrap gap-4">
            <div>
              <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Primary pool
              </div>
              <AddressLabel address="0xe365b92239097Ed3322131411DbE15a5c4068eff" showFull />
            </div>
          </div>

          <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-400)" }}>
            Note: Historical OHLC data is not yet available via Dexscreener for this
            token. A price history chart is planned for v1.1.
          </p>
        </MetricSection>

        {/* Contract Table */}
        <MetricSection title="All Protocol Contracts">
          <p style={{ fontSize: "0.875rem", color: "var(--color-silver-300)" }}>
            All indexed contract addresses with human labels and Blockscout
            links. This table is the authoritative reference for every address
            used in SLVRline&apos;s data pipeline.
          </p>
          <ContractTable />
        </MetricSection>

        {/* Footer note */}
        <div
          style={{
            marginTop: 32,
            padding: "16px",
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--color-silver-800)",
            backgroundColor: "var(--color-silver-900)",
          }}
        >
          <p style={{ fontSize: "0.75rem", color: "var(--color-silver-400)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--color-silver-300)" }}>
              Independent computation.
            </strong>{" "}
            SLVRline computes all metrics from its own indexed copy of Robinhood
            Chain data. It is not affiliated with slvr.fun, the SLVR team, or
            any other entity. All contract addresses are public on-chain facts.
            If you spot an error,{" "}
            <a
              href="https://robinhoodchain.blockscout.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              verify on Blockscout
            </a>
            .
          </p>
        </div>
      </PageContainer>
    </main>
  );
}
