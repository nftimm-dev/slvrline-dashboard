"use client";

import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import AddressCell from "@/components/analytics/AddressCell";
import StateMessage from "@/components/analytics/StateMessage";
import Panel from "@/components/analytics/Panel";
import ScreenshotStamp from "@/components/analytics/ScreenshotStamp";
import type { LotteryData } from "@/lib/lottery";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function slvr(n: number, decimals = 2): string {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n) + " SLVR"
  );
}

export default function LotteryView() {
  const { data, error, isLoading } = useSWR<LotteryData>(
    "/api/lottery",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const failed = !!error;

  if (failed) {
    return (
      <Panel title="Lottery snapshot">
        <StateMessage
          tone="error"
          title="Lottery data unavailable"
          detail="The Robinhood RPC did not respond. This snapshot refreshes every 30 seconds."
          height={220}
        />
      </Panel>
    );
  }

  return (
    <>
      {/* Live snapshot cards */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="CURRENT ROUND"
          primary={data ? `#${data.roundId.toLocaleString()}` : "—"}
          secondary="live mining round"
          colorVar="--color-lottery"
          loading={isLoading && !data}
        />
        <StatCard
          label="JACKPOT"
          primary={
            data
              ? `${data.jackpotEth.toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })} ETH`
              : "—"
          }
          secondary="current prize pool"
          colorVar="--color-price"
          loading={isLoading && !data}
        />
        <StatCard
          label="UNCLAIMED REWARDS"
          primary={data ? slvr(data.totalUnclaimedSlvr) : "—"}
          secondary="miner rewards pool"
          colorVar="--color-apr"
          loading={isLoading && !data}
        />
        <StatCard
          label="CUMULATIVE REFINED"
          primary={data ? slvr(data.totalRefinedSlvr) : "—"}
          secondary="total refining fees paid"
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="MINER INDEX"
          primary={
            data
              ? data.minerIndex.toLocaleString(undefined, {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                })
              : "—"
          }
          secondary="cumulative fee / unclaimed SLVR"
          colorVar="--color-supply"
          loading={isLoading && !data}
        />
        <StatCard
          label="JACKPOT CONTRACT"
          primary={
            data?.jackpotAddress ? (
              <span style={{ fontSize: "0.9375rem" }}>
                <AddressCell address={data.jackpotAddress} />
              </span>
            ) : (
              "—"
            )
          }
          secondary="ETH balance shown above"
          colorVar="--color-lottery"
          loading={isLoading && !data}
        />
      </div>

      {/* Explanatory caption */}
      <div
        className="relative"
        style={{
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-silver-800)",
          backgroundColor: "var(--color-silver-900)",
          borderLeft: "2px solid var(--color-lottery)",
          padding: "16px 18px 30px",
        }}
      >
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            color: "var(--color-lottery)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Grid Mining is how SLVR is emitted
        </div>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--color-silver-300)",
            lineHeight: 1.6,
            maxWidth: "72ch",
          }}
        >
          SLVR is emitted through Grid Mining: miners commit to grid cells
          each round for a chance at the jackpot. A refining fee on every claim
          is redistributed to all remaining <em>unclaimed</em> reward
          holders — that stream is what the{" "}
          <a
            href="/methodology"
            style={{ color: "var(--color-accent)", textDecoration: "none" }}
          >
            Dividends APR
          </a>{" "}
          measures. The <strong>miner index</strong> is the cumulative refining
          fee earned per 1 unclaimed SLVR (WAD-scaled), and reset to zero when V2
          deployed. This is a live snapshot, refreshed every 30 seconds.
        </p>
        {data && (
          <p
            style={{
              fontSize: "0.6875rem",
              color: "var(--color-silver-400)",
              marginTop: 10,
              fontFamily: "var(--font-mono)",
            }}
          >
            raw minerIndex: {data.minerIndexRaw}
          </p>
        )}
        <ScreenshotStamp />
      </div>
    </>
  );
}
