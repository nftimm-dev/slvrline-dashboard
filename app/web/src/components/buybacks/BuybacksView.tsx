"use client";

import type { CSSProperties } from "react";
import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import BuybackChartSection from "@/components/charts/BuybackChartSection";
import GrowthFundSection from "@/components/buybacks/GrowthFundSection";
import UnifiedRecentBuybacks from "@/components/buybacks/UnifiedRecentBuybacks";
import { getBlockscoutUrl } from "@/lib/labels";
import type { BuybackData } from "@/lib/buybacks";

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

export default function BuybacksView() {
  const { data, isLoading } = useSWR<BuybackData>("/api/buybacks", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const loading = isLoading && !data;
  const ethUsd = data?.ethUsd ?? null;

  return (
    <>
      {/* Protocol buyback-and-burn — headline stats */}
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
          primary={
            data
              ? data.cumulativeUsd != null
                ? usd(data.cumulativeUsd)
                : eth(data.cumulativeEth, 3)
              : "—"
          }
          secondary={data ? `${eth(data.cumulativeEth, 3)} at current ETH` : undefined}
          colorVar="--color-price"
          loading={loading}
        />
        <StatCard
          label="DAILY BUYBACK (24H)"
          primary={data ? `${slvr(data.dailySlvr, 1)}` : "—"}
          secondary={
            data ? `≈ ${usd(data.dailyUsd)} · ${eth(data.dailyEth, 2)} per day` : undefined
          }
          colorVar="--color-staking"
          loading={loading}
        />
        <StatCard
          label="CADENCE"
          primary={data?.avgIntervalSec != null ? `~${Math.round(data.avgIntervalSec)}s` : "—"}
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
      <BuybackChartSection ethUsd={ethUsd} />

      {/* Methodology note */}
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
          lineHeight: 1.6,
          maxWidth: "72ch",
        }}
      >
        <strong style={{ color: "var(--color-silver-300)" }}>How the burn works.</strong> A share of
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

      {/* Growth Fund flywheel — separate accumulation stream (earns → stakes → buys back) */}
      <GrowthFundSection />

      {/* Unified recent-buybacks feed — both streams, tagged by type */}
      <UnifiedRecentBuybacks />
    </>
  );
}

const linkStyle: CSSProperties = {
  color: "var(--color-silver-200)",
  textDecoration: "underline",
  textDecorationColor: "var(--color-silver-700)",
};
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
