"use client";

import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import LineChartSvg from "@/components/charts/LineChartSvg";
import { getBlockscoutUrl } from "@/lib/labels";
import { GROWTH_FUND_BUYER, type GrowthFundData } from "@/lib/growthFund";
import type { HistoryResponse } from "@/hooks/useHistory";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

const nf = (n: number, d = 2) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const slvr = (n: number, d = 1) => `${nf(n, d)} SLVR`;
const eth = (n: number, d = 2) => `${n.toFixed(d)} ETH`;
const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

export default function GrowthFundSection() {
  const { data, error, isLoading } = useSWR<GrowthFundData>("/api/growthfund", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const loading = isLoading && !data;
  const failed = !!error;

  const chartData: HistoryResponse | undefined = data
    ? {
        metric: "growthfund_bought",
        range: "all",
        rows: data.series.map((p) => ({ t: p.t, v: p.bought, v2: null, v3: null, block: null })),
      }
    : undefined;

  return (
    <section style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid var(--color-silver-800)" }}>
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          color: "var(--color-silver-100)",
          marginBottom: 6,
        }}
      >
        Growth Fund flywheel
      </h2>
      <p
        style={{
          fontSize: "0.875rem",
          color: "var(--color-silver-400)",
          marginBottom: 20,
          lineHeight: 1.55,
          maxWidth: "76ch",
        }}
      >
        A self-reinforcing loop, separate from the burn above:{" "}
        <strong style={{ color: "var(--color-silver-200)" }}>①</strong> the Growth Fund earns{" "}
        <strong style={{ color: "var(--color-silver-200)" }}>0.04 SLVR every round</strong> (4% of
        each round&rsquo;s mint) →{" "}
        <strong style={{ color: "var(--color-silver-200)" }}>②</strong> stakes it to earn{" "}
        <strong style={{ color: "var(--color-silver-200)" }}>ETH</strong> (the 8%-of-round-ETH staker
        cut) → <strong style={{ color: "var(--color-silver-200)" }}>③</strong> spends that ETH{" "}
        <a
          href={getBlockscoutUrl(GROWTH_FUND_BUYER)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--color-silver-200)", textDecoration: "underline", textDecorationColor: "var(--color-silver-700)" }}
        >
          buying SLVR back
        </a>{" "}
        on the open market — which it <em>keeps</em> (and re-stakes), compounding the loop.
      </p>

      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="① SLVR EARNED / ROUNDS"
          primary={data ? slvr(data.slvrEarned, 0) : "—"}
          secondary={data?.roundId != null ? `0.04 × ${data.roundId.toLocaleString()} rounds` : undefined}
          colorVar="--color-apr"
          loading={loading}
        />
        <StatCard
          label="② ETH READY TO DEPLOY"
          primary={data ? usd(data.ethWaitingUsd) : "—"}
          secondary={data ? `${eth(data.ethWaiting, 1)} · war chest, waiting to buy back` : undefined}
          colorVar="--color-price"
          loading={loading}
        />
        <StatCard
          label="③ ETH DEPLOYED"
          primary={data ? usd(data.usdDeployed) : "—"}
          secondary={data ? `${eth(data.ethDeployed, 2)} spent buying back` : undefined}
          colorVar="--color-supply"
          loading={loading}
        />
        <StatCard
          label="DEPLOYED (24H)"
          primary={data ? usd(data.deployed24hUsd) : "—"}
          secondary={data ? `${eth(data.deployed24hEth, 2)} · trailing 24h` : undefined}
          colorVar="--color-accent"
          loading={loading}
        />
        <StatCard
          label="④ SLVR BOUGHT BACK"
          primary={data ? slvr(data.slvrBought, 1) : "—"}
          secondary={
            data ? `${usd(data.holdingsUsd)} value · ${data.buyCount.toLocaleString()} buys` : undefined
          }
          colorVar="--color-staking"
          loading={loading}
        />
      </div>

      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-silver-200)" }}>
          Cumulative SLVR bought back{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            · Growth Fund accumulation
          </span>
        </h3>
      </div>
      <div
        className="overflow-hidden"
        style={{
          height: 256,
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-silver-800)",
          backgroundColor: "var(--color-silver-900)",
        }}
      >
        {failed ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-silver-400)",
              fontSize: "0.8125rem",
            }}
          >
            Growth Fund data unavailable
          </div>
        ) : (
          <LineChartSvg
            data={chartData}
            isLoading={loading}
            series={[{ key: "v", color: "#34d399", label: "SLVR bought" }]}
            format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + " SLVR"}
          />
        )}
      </div>
    </section>
  );
}
