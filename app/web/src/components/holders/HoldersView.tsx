"use client";

import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import Panel from "@/components/analytics/Panel";
import BarChartSvg, { type BarDatum } from "@/components/analytics/BarChartSvg";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import AddressCell from "@/components/analytics/AddressCell";
import StateMessage from "@/components/analytics/StateMessage";
import type { HoldersData, HolderRow } from "@/lib/holders";

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

function shortLabel(h: HolderRow): string {
  if (h.label) return h.label;
  return `${h.address.slice(0, 6)}…${h.address.slice(-4)}`;
}

export default function HoldersView() {
  const { data, error, isLoading } = useSWR<HoldersData>(
    "/api/holders",
    fetcher,
    { refreshInterval: 300_000 }
  );

  const failed = !!error;

  // Top-10 horizontal bars — protocol addresses tinted differently from wallets.
  const bars: BarDatum[] = (data?.top ?? []).slice(0, 10).map((h) => ({
    label: shortLabel(h),
    value: h.balanceSlvr,
    color: h.isContract ? "var(--color-staking)" : "var(--color-supply)",
  }));

  const columns: Column<HolderRow>[] = [
    {
      key: "rank",
      header: "#",
      mono: true,
      width: 40,
      render: (h) => (
        <span style={{ color: "var(--color-silver-400)" }}>{h.rank}</span>
      ),
    },
    {
      key: "addr",
      header: "Holder",
      render: (h) => (
        <AddressCell
          address={h.address}
          label={h.label}
          isContract={h.isContract}
        />
      ),
    },
    {
      key: "bal",
      header: "Balance",
      align: "right",
      mono: true,
      render: (h) => slvr(h.balanceSlvr),
    },
    {
      key: "pct",
      header: "% of supply",
      align: "right",
      mono: true,
      render: (h) => (
        <span
          style={{
            color:
              h.pctOfSupply >= 5
                ? "var(--color-silver-100)"
                : "var(--color-silver-300)",
          }}
        >
          {h.pctOfSupply.toFixed(2)}%
        </span>
      ),
    },
  ];

  return (
    <>
      {/* Headline cards */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="HOLDERS"
          primary={data?.holderCount != null ? data.holderCount.toLocaleString() : "—"}
          secondary="unique addresses"
          colorVar="--color-supply"
          loading={isLoading && !data}
        />
        <StatCard
          label="TOP-10 CONCENTRATION"
          primary={data ? `${data.top10Pct.toFixed(1)}%` : "—"}
          secondary="of current supply"
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="CURRENT SUPPLY"
          primary={data ? slvr(data.totalSupplySlvr, 0) : "—"}
          secondary="totalSupply() · denominator"
          colorVar="--color-price"
          loading={isLoading && !data}
        />
      </div>

      {/* Top 10 bar chart */}
      <Panel
        title="Top 10 holders"
        note={
          <span>
            <span style={{ color: "var(--color-staking)" }}>■</span> contract{" "}
            <span style={{ color: "var(--color-supply)", marginLeft: 8 }}>■</span>{" "}
            wallet
          </span>
        }
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Holder data unavailable"
            detail="The Blockscout API did not respond. This panel refreshes automatically."
            height={280}
          />
        ) : (
          <BarChartSvg
            data={bars}
            layout="vertical"
            valueLabel="Balance"
            format={(n) => slvr(n, 0)}
            height={Math.max(220, bars.length * 34 + 40)}
          />
        )}
      </Panel>

      {/* Full ranked table */}
      <Panel title="Holder rankings" note="protocol addresses tagged" flush>
        {failed ? (
          <StateMessage
            tone="error"
            title="Rankings unavailable"
            detail="Could not load holders from Blockscout."
            height={200}
          />
        ) : (
          <DataTable<HolderRow>
            columns={columns}
            rows={data?.top ?? []}
            rowKey={(h) => h.address}
            loading={isLoading && !data}
            skeletonRows={10}
            emptyMessage="No holders found"
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
        Source: Blockscout token holders. Percentages are of current{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>totalSupply()</code>.
        Protocol contracts (vote escrow, lottery, LP, DEX pools) are tagged{" "}
        <em>contract</em> — much of the top of the list is protocol-owned, not
        individual wallets. Cached 5 min.
      </p>
    </>
  );
}
