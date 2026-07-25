"use client";

import useSWR from "swr";
import StatCard from "@/components/analytics/StatCard";
import Panel from "@/components/analytics/Panel";
import BarChartSvg, { type BarDatum } from "@/components/analytics/BarChartSvg";
import DonutChart, {
  DonutLegend,
  type DonutSlice,
} from "@/components/analytics/DonutChart";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import AddressCell from "@/components/analytics/AddressCell";
import StateMessage from "@/components/analytics/StateMessage";
import type { StakingData, TopLocker } from "@/lib/staking";

interface AprRow {
  key: string;
  label: string;
  durationDays: number | null;
  multiplier: number;
  aprPercent: number;
  aprDisplay: string;
}

interface StakingRewardsData {
  mode: "apr" | "relative_weight";
  rewardToken: string;
  window_days: number;
  eth_per_day: number;
  rows: AprRow[];
  params: {
    tmaxMonths: number;
    mmax: number;
    permanentMultiplier: number;
  };
  source: string;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

function slvr(n: number, decimals = 0): string {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n) + " SLVR"
  );
}

function compactSlvr(n: number): string {
  if (n >= 1000)
    return (
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n) +
      " SLVR"
    );
  return slvr(n, 1);
}

function LockTag({ locker }: { locker: TopLocker }) {
  const perm = locker.allPermanent;
  const color = perm ? "var(--color-supply)" : "var(--color-staking)";
  const text = perm
    ? "Permanent"
    : locker.hasPermanent
      ? "Mixed"
      : "Time-lock";
  return (
    <span
      style={{
        fontSize: "0.5625rem",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "1px 6px",
        fontWeight: 600,
        opacity: 0.9,
      }}
    >
      {text}
    </span>
  );
}

export default function StakingView() {
  const { data, error, isLoading } = useSWR<StakingData>(
    "/api/staking",
    fetcher,
    {
      refreshInterval: 1_800_000, // 30 min (matches server cache)
      revalidateOnFocus: false,
    }
  );

  const { data: rewards, error: rewardsError } = useSWR<StakingRewardsData>(
    "/api/staking-rewards",
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false } // 5 min (matches server cache)
  );

  const failed = !!error;
  const isAprMode = rewards?.mode === "apr";

  // Bar chart values: APR % when mode=apr, else multiplier fallback
  const rewardBars: BarDatum[] = (rewards?.rows ?? []).map((r) => ({
    label: r.label,
    value: isAprMode ? r.aprPercent : r.multiplier,
    color:
      r.key === "permanent" ? "var(--color-supply)" : "var(--color-staking)",
  }));

  const donutSlices: DonutSlice[] = data
    ? [
        {
          label: "Permanent",
          value: data.permanentSlvr,
          color: "var(--color-supply)",
        },
        {
          label: "Time-locked",
          value: data.timelockedSlvr,
          color: "var(--color-staking)",
        },
      ]
    : [];

  const bucketBars: BarDatum[] = (data?.sizeBuckets ?? []).map((b) => ({
    label: b.range,
    value: b.count,
    color: "var(--color-staking)",
  }));

  const lockerColumns: Column<TopLocker>[] = [
    {
      key: "rank",
      header: "#",
      mono: true,
      width: 40,
      render: (_l, i) => (
        <span style={{ color: "var(--color-silver-400)" }}>{i + 1}</span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      render: (l) => <AddressCell address={l.owner} label={l.label} />,
    },
    {
      key: "amount",
      header: "Locked",
      align: "right",
      mono: true,
      render: (l) => slvr(l.amountSlvr, 2),
    },
    {
      key: "locks",
      header: "Locks",
      align: "right",
      mono: true,
      render: (l) => (
        <span style={{ color: "var(--color-silver-400)" }}>{l.lockCount}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      align: "right",
      render: (l) => <LockTag locker={l} />,
    },
  ];

  return (
    <>
      {/* Headline cards */}
      <div className="grid gap-3 mb-8 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="TOTAL STAKED"
          primary={data ? compactSlvr(data.totalLockedSlvr) : "—"}
          secondary={
            data ? `${data.activeLockCount} active locks` : "veSLVR locks"
          }
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="PERMANENT"
          primary={data ? compactSlvr(data.permanentSlvr) : "—"}
          secondary="never unlocks · burned"
          colorVar="--color-supply"
          loading={isLoading && !data}
        />
        <StatCard
          label="TIME-LOCKED"
          primary={data ? compactSlvr(data.timelockedSlvr) : "—"}
          secondary="decays to unlock"
          colorVar="--color-staking"
          loading={isLoading && !data}
        />
        <StatCard
          label="AVG LOCK"
          primary={data ? slvr(data.avgLockSlvr, 1) : "—"}
          secondary={data ? `${data.uniqueOwners} unique owners` : undefined}
          colorVar="--color-apr"
          loading={isLoading && !data}
        />
      </div>

      {/* Split: donut + distribution side by side on wide screens */}
      <div className="grid gap-6 lg:grid-cols-2 mb-2">
        <Panel title="Permanent vs time-locked">
          {failed ? (
            <StateMessage
              tone="error"
              title="Staking data unavailable"
              detail="The Robinhood RPC did not respond. This recomputes on a 30-minute cache."
              height={240}
            />
          ) : isLoading && !data ? (
            <StateMessage title="Reading on-chain locks…" detail="Enumerating ~1,600 lock NFTs." height={240} />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div style={{ flex: "0 0 220px", width: 220 }}>
                <DonutChart
                  slices={donutSlices}
                  format={(n) => slvr(n, 0)}
                  centerValue={data ? compactSlvr(data.totalLockedSlvr) : ""}
                  centerLabel="total"
                  height={220}
                />
              </div>
              <div className="flex-1 w-full">
                <DonutLegend slices={donutSlices} format={(n) => slvr(n, 0)} />
                <p
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-silver-400)",
                    marginTop: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Permanent locks <strong>burn</strong> the underlying SLVR — it
                  leaves circulating supply for good.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Lock-size distribution" note="lock count by SLVR size">
          {failed ? (
            <StateMessage
              tone="error"
              title="Distribution unavailable"
              height={240}
            />
          ) : (
            <BarChartSvg
              data={bucketBars}
              layout="horizontal"
              color="var(--color-staking)"
              valueLabel="Locks"
              format={(n) => n.toLocaleString()}
              height={240}
            />
          )}
        </Panel>
      </div>

      {/* Top lockers */}
      <Panel
        title="Top lockers"
        note={
          data
            ? `Top ${data.topLockers.length} of ${data.activeLockCount.toLocaleString()} locks · ${data.uniqueOwners.toLocaleString()} owners`
            : "by total locked SLVR"
        }
        flush
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Top lockers unavailable"
            detail="Could not read locks from the Robinhood RPC."
            height={200}
          />
        ) : (
          <DataTable<TopLocker>
            columns={lockerColumns}
            rows={data?.topLockers ?? []}
            rowKey={(l) => l.owner}
            loading={isLoading && !data}
            skeletonRows={8}
            emptyMessage="No active locks found"
            maxHeight={440}
          />
        )}
      </Panel>

      {/* Rewards by lock length */}
      <Panel
        title="Rewards by lock length"
        note={
          isAprMode
            ? `absolute ETH APR · ${rewards!.window_days}-day trailing window · ~${rewards!.eth_per_day.toFixed(2)} ETH/day to stakers`
            : "relative veSLVR reward weight — longer locks earn proportionally more"
        }
      >
        {rewardsError ? (
          <StateMessage
            tone="error"
            title="Reward data unavailable"
            detail="Could not read veSLVR staking rewards from the Robinhood RPC."
            height={220}
          />
        ) : (
          <>
            <BarChartSvg
              data={rewardBars}
              layout="horizontal"
              color="var(--color-staking)"
              valueLabel={isAprMode ? "APR %" : "Weight ×"}
              format={(n) =>
                isAprMode
                  ? n >= 1000
                    ? new Intl.NumberFormat("en-US", {
                        maximumFractionDigits: 0,
                      }).format(n) + "%"
                    : n.toFixed(0) + "%"
                  : `${n.toFixed(3)}×`
              }
              height={220}
            />

            {/* ETH asset badge + multiplier secondary info */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "0.625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-price)",
                  border: "1px solid var(--color-price)",
                  borderRadius: 4,
                  padding: "1px 7px",
                  fontWeight: 700,
                }}
              >
                earns ETH
              </span>
              {isAprMode && rewards && (
                <span
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-silver-400)",
                  }}
                >
                  weight multipliers:{" "}
                  {rewards.rows
                    .map((r) => `${r.label} ${r.multiplier.toFixed(2)}×`)
                    .join(" · ")}
                </span>
              )}
            </div>

            <p
              style={{
                fontSize: "0.6875rem",
                color: "var(--color-silver-400)",
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              {isAprMode && rewards ? (
                <>
                  veSLVR staking rewards are paid in <strong>ETH</strong>.
                  APR shown is absolute (ETH yield annualised / SLVR staked value),
                  using a{" "}
                  <strong>{rewards.window_days}-day trailing window</strong> —
                  early &amp; volatile. Multipliers per lock length are shown
                  above; permanent locks (
                  {rewards.params.permanentMultiplier.toFixed(1)}×) cannot be
                  unstaked. Source: <code>rewardPerWeightStored</code> Δ ·{" "}
                  <code>TMAX / MMAX / P</code>.
                </>
              ) : (
                <>
                  Reward <strong>weight multiplier per SLVR</strong>, not an APR.
                  veSLVR staking pays protocol revenue (in{" "}
                  {rewards?.rewardToken ?? "ETH"}) pro-rata to voting weight, and
                  weight scales linearly with lock length — from{" "}
                  <strong>1.0×</strong> up to{" "}
                  <strong>
                    {(rewards?.params.mmax ?? 2.5).toFixed(2)}×
                  </strong>{" "}
                  at the {rewards?.params.tmaxMonths ?? 4}-month max lock, with
                  permanent locks fixed at{" "}
                  <strong>
                    {(rewards?.params.permanentMultiplier ?? 4).toFixed(1)}×
                  </strong>
                  . Source: <code>getStakingWeight</code> · TMAX / MMAX / P.
                </>
              )}
            </p>
          </>
        )}
      </Panel>

      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
        }}
      >
        Source: Robinhood Chain RPC. Every ve lock NFT is enumerated and read
        directly from the vote-escrow contract&apos;s current state — withdrawn
        locks read zero and drop out automatically. LP staking:{" "}
        {data ? slvr(data.lpStaked, 2) : "—"} of SLVR/WETH LP. Recomputed on a
        30-minute cache.
      </p>
    </>
  );
}
