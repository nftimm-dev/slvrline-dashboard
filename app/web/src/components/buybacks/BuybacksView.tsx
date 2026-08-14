"use client";

import type { CSSProperties } from "react";
import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import Panel from "@/components/analytics/Panel";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import StateMessage from "@/components/analytics/StateMessage";
import BuybackChartSection from "@/components/charts/BuybackChartSection";
import { getBlockscoutUrl } from "@/lib/labels";
import type { BuybackData, BuybackRecentEvent } from "@/lib/buybacks";

const KEEPER = "0x7a58D6f46E92b02618EdB4f5ff3b72f7E64077Ad";
const EXECUTOR = "0xacdd8E9bad637798dBdb23a59cfa314743668bA4";
const GRAVEYARD = "0xF32Fc533511783b2707A08eEA22A9f4E59996100";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function fmt(n: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
const slvr = (n: number, d = 2) => `${fmt(n, d)} SLVR`;
const eth = (n: number, d = 4) => `${n.toFixed(d)} ETH`;
const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const recentColumns: Column<BuybackRecentEvent>[] = [
  {
    key: "when",
    header: "When",
    render: (e) => (
      <span style={{ color: "var(--color-silver-300)" }}>{relTime(e.approxTs)}</span>
    ),
  },
  {
    key: "eth",
    header: "ETH spent",
    align: "right",
    mono: true,
    render: (e) => e.eth.toFixed(5),
  },
  {
    key: "slvr",
    header: "SLVR burned",
    align: "right",
    mono: true,
    render: (e) => (
      <span style={{ color: "var(--color-apr)" }}>{e.slvr.toFixed(4)}</span>
    ),
  },
];

export default function BuybacksView() {
  const { data, error, isLoading } = useSWR<BuybackData>("/api/buybacks", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const failed = !!error;
  const loading = isLoading && !data;

  return (
    <>
      {/* Headline stats */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="BOUGHT BACK & BURNED"
          primary={data ? slvr(data.cumulativeSlvr, 2) : "—"}
          secondary={
            data ? `${data.buybackCount.toLocaleString()} buybacks since launch` : undefined
          }
          colorVar="--color-apr"
          loading={loading}
        />
        <StatCard
          label="TOTAL SPENT"
          primary={data ? eth(data.cumulativeEth, 3) : "—"}
          secondary={data ? `${usd(data.cumulativeUsd)} at current ETH` : undefined}
          colorVar="--color-price"
          loading={loading}
        />
        <StatCard
          label="DAILY BUYBACK (24H)"
          primary={data ? `${slvr(data.dailySlvr, 1)}` : "—"}
          secondary={
            data ? `≈ ${eth(data.dailyEth, 3)} · ${usd(data.dailyUsd)} per day` : undefined
          }
          colorVar="--color-staking"
          loading={loading}
        />
        <StatCard
          label="CADENCE"
          primary={
            data?.avgIntervalSec != null ? `~${Math.round(data.avgIntervalSec)}s` : "—"
          }
          secondary={
            data?.buybacksPerDay != null
              ? `~${Math.round(data.buybacksPerDay).toLocaleString()} buybacks / day`
              : "between buybacks"
          }
          colorVar="--color-supply"
          loading={loading}
        />
      </div>

      {/* Cumulative chart */}
      <BuybackChartSection />

      {/* Recent buybacks */}
      <Panel
        title="Recent buybacks"
        note="latest on-chain BuybackBurned events · newest first"
        flush
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Buyback data unavailable"
            detail="Could not load the latest buyback snapshot. This panel refreshes automatically."
            height={200}
          />
        ) : (
          <DataTable<BuybackRecentEvent>
            columns={recentColumns}
            rows={data?.recent ?? []}
            rowKey={(e, i) => `${e.block}-${i}`}
            loading={loading}
            skeletonRows={8}
            emptyMessage="No buybacks recorded yet"
          />
        )}
      </Panel>

      {/* Methodology note */}
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 16,
          lineHeight: 1.6,
          maxWidth: "72ch",
        }}
      >
        <strong style={{ color: "var(--color-silver-300)" }}>How it works.</strong> A share of
        mining revenue accumulates in the{" "}
        <a href={getBlockscoutUrl(KEEPER)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          buyback keeper
        </a>
        , which every ~80 seconds calls the{" "}
        <a href={getBlockscoutUrl(EXECUTOR)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          executor
        </a>{" "}
        to swap ETH for SLVR on the Uniswap V4 pool and forward every token to the{" "}
        <a href={getBlockscoutUrl(GRAVEYARD)} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          SLVR Graveyard
        </a>{" "}
        — a contract with no way to move anything out, so the SLVR is permanently removed from
        circulation. This is distinct from protocol burns to <code style={mono}>0x0</code> (which
        cut <code style={mono}>totalSupply</code> and reopen mint headroom); graveyard SLVR stays
        in <code style={mono}>totalSupply</code> but is subtracted from circulating supply. Totals
        are the exact sum of the executor&rsquo;s <code style={mono}>BuybackBurned</code> events and
        reconcile to the graveyard&rsquo;s on-chain balance
        {data?.graveyardMatch === false ? " (currently diverging — see snapshot)" : ""}. USD uses
        the current ETH price. Updated every 5 min.
      </p>
    </>
  );
}

const linkStyle: CSSProperties = {
  color: "var(--color-silver-200)",
  textDecoration: "underline",
  textDecorationColor: "var(--color-silver-700)",
};
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
