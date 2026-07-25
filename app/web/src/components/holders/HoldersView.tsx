"use client";

import { useState } from "react";
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

function num(n: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function shortLabel(h: HolderRow): string {
  if (h.label) return h.label;
  return `${h.address.slice(0, 6)}…${h.address.slice(-4)}`;
}

/**
 * Economic composition line: "wallet 800 · unclaimed 300 · staked 100" — only
 * the non-zero parts. Each source tinted with its own accent for a quick read.
 */
function Composition({ h }: { h: HolderRow }) {
  const c = h.composition;
  if (!c) return null;
  const parts: Array<{ label: string; value: number; colorVar: string }> = [
    { label: "wallet", value: c.wallet, colorVar: "--color-supply" },
    { label: "unclaimed", value: c.unclaimed, colorVar: "--color-staking" },
    { label: "staked", value: c.staked, colorVar: "--color-apr" },
  ].filter((p) => p.value > 0.005);

  if (parts.length <= 1) return null; // single-source → breakdown adds nothing

  return (
    <div
      style={{
        marginTop: 3,
        fontSize: "0.6875rem",
        color: "var(--color-silver-400)",
        fontFamily: "var(--font-mono)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
      }}
    >
      {parts.map((p, i) => (
        <span key={p.label} style={{ display: "inline-flex", gap: 4 }}>
          {i > 0 && (
            <span style={{ color: "var(--color-silver-700)" }}>·</span>
          )}
          <span style={{ color: `var(${p.colorVar})` }}>{p.label}</span>
          <span style={{ color: "var(--color-silver-300)" }}>{num(p.value)}</span>
        </span>
      ))}
    </div>
  );
}

export default function HoldersView() {
  const [economic, setEconomic] = useState(false);

  const { data, error, isLoading } = useSWR<HoldersData>(
    economic ? "/api/holders?economic=1" : "/api/holders",
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const failed = !!error;

  // Split the ranked list on isProtocol — only CURATED protocol addresses (vote
  // escrow, unclaimed pools, LP pairs, DEX, vesting, treasury) move to their own
  // section. Uncatalogued contracts (FOMO wallets, Blockscout-named contracts)
  // are real holders and stay in the rankings.
  const allRows = data?.top ?? [];
  const wallets: HolderRow[] = allRows
    .filter((h) => !h.isProtocol)
    .map((h, i) => ({ ...h, rank: i + 1 }));
  const protocolRows: HolderRow[] = allRows.filter((h) => h.isProtocol);

  // Concentration among real holders only (recomputed client-side from wallets).
  const walletTop10Pct = wallets
    .slice(0, 10)
    .reduce((sum, h) => sum + h.pctOfSupply, 0);

  // Top-10 horizontal bars — real holders only.
  const bars: BarDatum[] = wallets.slice(0, 10).map((h) => ({
    label: shortLabel(h),
    value: h.balanceSlvr,
    color: "var(--color-supply)",
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
        <div>
          <AddressCell
            address={h.address}
            label={h.label}
            isContract={h.isContract}
          />
          {economic && <Composition h={h} />}
        </div>
      ),
    },
    {
      key: "bal",
      header: economic ? "Economic balance" : "Balance",
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

  // Protocol-address table: no competitive rank column — these aren't "holders".
  const contractColumns: Column<HolderRow>[] = [
    {
      key: "addr",
      header: "Protocol address",
      render: (h) => (
        <AddressCell address={h.address} label={h.label} isContract={h.isContract} />
      ),
    },
    {
      key: "bal",
      header: economic ? "Economic balance" : "Balance",
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
        <span style={{ color: "var(--color-silver-300)" }}>
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
          label="TOP-10 WALLETS"
          primary={data ? `${walletTop10Pct.toFixed(1)}%` : "—"}
          secondary="of supply · real holders"
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

      {/* Economic-attribution toggle */}
      <EconomicToggle checked={economic} onChange={setEconomic} />

      {economic && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "var(--color-silver-400)",
            margin: "0 0 20px",
            lineHeight: 1.5,
            maxWidth: "68ch",
          }}
        >
          <strong style={{ color: "var(--color-silver-300)" }}>
            Economic view.
          </strong>{" "}
          The Grid Mining contract holds{" "}
          <span style={{ color: "var(--color-staking)" }}>unclaimed SLVR</span>{" "}
          owed to individual miners, and the Vote Escrow contract holds{" "}
          <span style={{ color: "var(--color-apr)" }}>time-locked SLVR</span>{" "}
          owned by individual stakers. Here those pooled balances are
          reattributed to the real owners — a pure reattribution, so the total is
          unchanged.{" "}
          <em>Permanent locks are burned (removed from supply) and excluded.</em>
        </p>
      )}

      {/* Top 10 bar chart */}
      <Panel
        title={economic ? "Top 10 economic holders" : "Top 10 holders"}
        note="individual wallets · protocol addresses excluded"
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

      {/* Real-holder rankings — protocol contracts are pulled out below */}
      <Panel
        title={economic ? "Economic holder rankings" : "Holder rankings"}
        note="individual wallets only"
        flush
      >
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
            rows={wallets}
            rowKey={(h) => h.address}
            loading={isLoading && !data}
            skeletonRows={10}
            emptyMessage="No wallet holders found"
          />
        )}
      </Panel>

      {/* Protocol addresses — their own section, deliberately not "holders" */}
      {!failed && protocolRows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Panel
            title="Protocol addresses"
            note="known protocol contracts · not individual holders"
            flush
          >
            <DataTable<HolderRow>
              columns={contractColumns}
              rows={protocolRows}
              rowKey={(h) => h.address}
              emptyMessage="No protocol addresses"
            />
          </Panel>
        </div>
      )}

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
        }}
      >
        {economic ? (
          <>
            Economic view: Blockscout wallet balances with the Grid Mining
            unclaimed pool (per-miner <code style={{ fontFamily: "var(--font-mono)" }}>rewardsSlvr</code>)
            and the Vote Escrow time-locked pool (per-owner non-permanent locks)
            reattributed to their owners. Permanent locks are burned and
            excluded. Percentages are of current{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>totalSupply()</code>.
            Cached 5 min.
          </>
        ) : (
          <>
            Source: Blockscout token holders. Percentages are of current{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>totalSupply()</code>.
            Protocol contracts (vote escrow, unclaimed pools, LP, DEX, vesting,
            treasury) are listed separately under{" "}
            <em>Protocol addresses</em> — the rankings above are individual
            wallets only. Cached 5 min.
          </>
        )}
      </p>
    </>
  );
}

/** Silver-styled checkbox row that switches raw ↔ economic attribution. */
function EconomicToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        userSelect: "none",
        marginBottom: checked ? 12 : 20,
        padding: "9px 14px",
        borderRadius: "var(--radius-chip)",
        border: "1px solid var(--color-silver-800)",
        backgroundColor: "var(--color-silver-900)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "relative",
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: 4,
          border: `1px solid ${
            checked ? "var(--color-accent)" : "var(--color-silver-700)"
          }`,
          backgroundColor: checked ? "var(--color-accent)" : "transparent",
          transition: "background-color 120ms, border-color 120ms",
        }}
      >
        {checked && (
          <svg
            viewBox="0 0 16 16"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          >
            <path
              d="M4 8.2l2.6 2.6L12 5.4"
              fill="none"
              stroke="var(--color-silver-950)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: checked ? "var(--color-silver-100)" : "var(--color-silver-300)",
        }}
      >
        Include unclaimed &amp; time-locked SLVR
      </span>
    </label>
  );
}
