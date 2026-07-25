"use client";

import useSWR from "swr";
import { ExternalLink } from "lucide-react";
import StatCard from "@/components/analytics/StatCard";
import Panel from "@/components/analytics/Panel";
import BarChartSvg, { type BarDatum } from "@/components/analytics/BarChartSvg";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import StateMessage from "@/components/analytics/StateMessage";
import type { MarketsData, MarketPair } from "@/lib/markets";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function usd(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toPrecision(4);
}

function priceUsd(n: number): string {
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toPrecision(4);
}

export default function MarketsView() {
  const { data, error, isLoading } = useSWR<MarketsData>(
    "/api/markets",
    fetcher,
    { refreshInterval: 60_000 }
  );

  const failed = !!error;

  const venueBars: BarDatum[] = (data?.byVenue ?? []).map((v) => ({
    label: v.venue,
    value: v.liquidityUsd,
    color: "var(--color-price)",
  }));

  const columns: Column<MarketPair>[] = [
    {
      key: "venue",
      header: "Venue",
      render: (p) => (
        <span style={{ color: "var(--color-silver-200)" }}>{p.venue}</span>
      ),
    },
    {
      key: "pair",
      header: "Pair",
      mono: true,
      render: (p) => (
        <span style={{ color: "var(--color-silver-300)" }}>{p.pair}</span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      mono: true,
      render: (p) => priceUsd(p.priceUsd),
    },
    {
      key: "liq",
      header: "Liquidity",
      align: "right",
      mono: true,
      render: (p) => usd(p.liquidityUsd),
    },
    {
      key: "vol",
      header: "24h Volume",
      align: "right",
      mono: true,
      render: (p) => usd(p.volume24h),
    },
    {
      key: "link",
      header: "",
      align: "right",
      render: (p) => (
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--color-accent)",
            textDecoration: "none",
            fontSize: "0.75rem",
          }}
        >
          Dexscreener
          <ExternalLink style={{ width: 11, height: 11 }} />
        </a>
      ),
    },
  ];

  return (
    <>
      {/* Headline cards */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="TOTAL LIQUIDITY"
          primary={data ? usd(data.totalLiquidityUsd) : "—"}
          secondary="across all pools"
          colorVar="--color-price"
          loading={isLoading && !data}
        />
        <StatCard
          label="24H VOLUME"
          primary={data ? usd(data.totalVolume24h) : "—"}
          secondary="all pools · trailing 24h"
          colorVar="--color-apr"
          loading={isLoading && !data}
        />
        <StatCard
          label="ACTIVE POOLS"
          primary={data ? String(data.poolCount) : "—"}
          secondary={data?.primaryVenue ? `deepest: ${data.primaryVenue}` : undefined}
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="SLVR PRICE"
          primary={data ? priceUsd(data.priceUsd) : "—"}
          secondary="deepest-pool mid"
          colorVar="--color-supply"
          loading={isLoading && !data}
        />
      </div>

      {/* Liquidity by venue */}
      <Panel
        title="Liquidity by venue"
        note={data ? `${data.byVenue.length} venues` : undefined}
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Markets data unavailable"
            detail="The Dexscreener API did not respond. This panel refreshes automatically."
            height={240}
          />
        ) : (
          <BarChartSvg
            data={venueBars}
            layout="vertical"
            color="var(--color-price)"
            valueLabel="Liquidity"
            format={usd}
            height={Math.max(180, venueBars.length * 56 + 40)}
          />
        )}
      </Panel>

      {/* All pairs */}
      <Panel title="All pools" note="sorted by liquidity" flush>
        {failed ? (
          <StateMessage
            tone="error"
            title="Pools unavailable"
            detail="Could not load pool data from Dexscreener."
            height={200}
          />
        ) : (
          <DataTable<MarketPair>
            columns={columns}
            rows={data?.pairs ?? []}
            rowKey={(p) => p.pairAddress}
            loading={isLoading && !data}
            emptyMessage="No pools found"
          />
        )}
      </Panel>

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
        }}
      >
        Source: Dexscreener, aggregated across all indexed SLVR pools on Robinhood
        Chain. Prices are per-pool; the headline price reflects the deepest pool.
        Cached 60s.
      </p>
    </>
  );
}
