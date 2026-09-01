"use client";

import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import Panel from "@/components/analytics/Panel";
import BarChartSvg, { type BarDatum } from "@/components/analytics/BarChartSvg";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import AddressCell from "@/components/analytics/AddressCell";
import StateMessage from "@/components/analytics/StateMessage";
import type { MiningUnclaimedData, UnclaimedMinerRow } from "@/lib/miningUnclaimed";

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

function shortLabel(m: UnclaimedMinerRow): string {
  if (m.label) return m.label;
  return `${m.address.slice(0, 6)}…${m.address.slice(-4)}`;
}

/** Tiny inline share bar sized to a miner's % of the pool. */
function ShareBar({ pct }: { pct: number }) {
  return (
    <div
      style={{
        position: "relative",
        width: 72,
        height: 6,
        borderRadius: 3,
        backgroundColor: "var(--color-silver-800)",
        overflow: "hidden",
      }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${Math.max(2, Math.min(100, pct))}%`,
          backgroundColor: "var(--color-apr)",
          opacity: 0.85,
          borderRadius: 3,
        }}
      />
    </div>
  );
}

export default function UnclaimedMinersSection() {
  const { data, error, isLoading } = useSWR<MiningUnclaimedData>(
    "/api/mining-unclaimed",
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false } // 5 min (matches server cache)
  );

  const failed = !!error;

  const bars: BarDatum[] = (data?.top ?? []).slice(0, 12).map((m) => ({
    label: shortLabel(m),
    value: m.unclaimedSlvr,
    color: "var(--color-apr)",
  }));

  const columns: Column<UnclaimedMinerRow>[] = [
    {
      key: "rank",
      header: "#",
      mono: true,
      width: 40,
      render: (m) => (
        <span style={{ color: "var(--color-silver-400)" }}>{m.rank}</span>
      ),
    },
    {
      key: "addr",
      header: "Miner",
      render: (m) => <AddressCell address={m.address} label={m.label} />,
    },
    {
      key: "unclaimed",
      header: "Unclaimed",
      align: "right",
      mono: true,
      render: (m) => slvr(m.unclaimedSlvr),
    },
    {
      key: "pct",
      header: "% of pool",
      align: "right",
      mono: true,
      render: (m) => (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <ShareBar pct={m.pct} />
          <span
            style={{
              color:
                m.pct >= 10
                  ? "var(--color-silver-100)"
                  : "var(--color-silver-300)",
              minWidth: 48,
              textAlign: "right",
            }}
          >
            {m.pct.toFixed(2)}%
          </span>
        </span>
      ),
    },
  ];

  return (
    <section style={{ marginTop: 40 }}>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "var(--color-silver-100)",
            marginBottom: 6,
            lineHeight: 1.2,
          }}
        >
          Unclaimed SLVR by miner
        </h2>
        <p
          style={{
            color: "var(--color-silver-400)",
            fontSize: "0.9375rem",
            maxWidth: "72ch",
            lineHeight: 1.5,
          }}
        >
          The permanent Miner State Vault holds the active unclaimed mining-rewards
          pool. This is who is owed its attributed portion — each miner&apos;s balance from{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>
            getMinerState().rewardsSlvr
          </code>
          , enumerated from every miner who has ever placed a bet.
        </p>
      </div>

      {/* Reconciliation headline cards */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="UNCLAIMED POOL"
          primary={data ? slvr(data.totalUnclaimed, 1) : "—"}
          secondary="totalUnclaimed() · on-chain"
          colorVar="--color-apr"
          loading={isLoading && !data}
        />
        <StatCard
          label="MINERS OWED"
          primary={data ? data.minerCount.toLocaleString() : "—"}
          secondary={
            data
              ? `of ${data.minersEnumerated.toLocaleString()} who mined`
              : "rewardsSlvr > 0"
          }
          colorVar="--color-supply"
          loading={isLoading && !data}
        />
        <StatCard
          label="SUM OF MINERS"
          primary={data ? slvr(data.sumMinerUnclaimed, 1) : "—"}
          secondary="Σ getMinerState.rewardsSlvr"
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="RESERVED"
          primary={data ? slvr(data.reservedUnattributed, 1) : "—"}
          secondary={
            data
              ? `${data.reconciliationPct.toFixed(2)}% not yet attributed`
              : "resolved, awaiting claims"
          }
          colorVar="--color-price"
          loading={isLoading && !data}
        />
      </div>

      {/* Top miners bar */}
      <Panel
        title="Top miners owed"
        note="unclaimed SLVR — largest positions in the pool"
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Unclaimed-by-miner data unavailable"
            detail="Could not enumerate miners or read getMinerState from the Robinhood RPC. This refreshes on a 5-minute cache."
            height={280}
          />
        ) : (
          <BarChartSvg
            data={bars}
            layout="vertical"
            color="var(--color-apr)"
            valueLabel="Unclaimed"
            format={(n) => slvr(n, 1)}
            height={Math.max(220, bars.length * 30 + 40)}
          />
        )}
      </Panel>

      {/* Ranked table */}
      <Panel
        title="Miner rankings"
        note={
          data
            ? `top ${data.top.length} of ${data.minerCount.toLocaleString()} owed`
            : "by unclaimed SLVR"
        }
        flush
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Rankings unavailable"
            detail="Could not read miner states from the Robinhood RPC."
            height={200}
          />
        ) : (
          <DataTable<UnclaimedMinerRow>
            columns={columns}
            rows={data?.top ?? []}
            rowKey={(m) => m.address}
            loading={isLoading && !data}
            skeletonRows={10}
            emptyMessage="No miners currently owed"
            maxHeight={520}
          />
        )}
      </Panel>

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
          lineHeight: 1.6,
        }}
      >
        Source: Robinhood Chain RPC plus the protocol event index. Candidate addresses
        come from its MinerAccount set, with raw vault{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>Credited</code> /{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>MigratedIn</code> logs scanned
        from the indexer&apos;s exact head to the chain head;
        each miner&apos;s balance is then independently re-read on-chain from{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>rewardsSlvr</code> from{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>getMinerState()</code>,
        read via Multicall3. Per-miner balances plus{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>reserved()</code> reconcile to{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>totalUnclaimed()</code>{" "}
        {data ? (
          <>
            exactly; the reserved portion is{" "}
            <strong>
              {data.reconciliationPct.toFixed(2)}%
            </strong>{" "}
            ({data.reconciliationResidual.toFixed(2)} SLVR)
          </>
        ) : (
          "closely"
        )}
        . Reserved SLVR is emitted rewards from resolved rounds whose winners have
        not yet claimed, so
        they cannot be attributed to an address yet. A separate refining bonus (
        <code style={{ fontFamily: "var(--font-mono)" }}>refinedAccrued</code>) is
        tracked per miner but is not part of this pool. Cached 5 min.
      </p>
    </section>
  );
}
