"use client";

import useSWR from "swr";
import Panel from "@/components/analytics/Panel";
import StateMessage from "@/components/analytics/StateMessage";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

type Asset = "SLVR" | "ETH";

interface EarnOption {
  key: string;
  rank: number;
  track: "dividends" | "staking";
  name: string;
  headline: {
    value: number | null;
    unit: "percent" | "multiplier";
    display: string;
  };
  asset: Asset;
  headlineNote: string;
  reliability: "live_volatile" | "relative_weight";
  reliabilityLabel: string;
  howTo: string;
  multiplier?: number;
  durationDays?: number | null;
}

interface EarnResponse {
  options: EarnOption[];
  dividends: {
    aprPercent: number | null;
    dataStatus: string;
    snapshotAt: string | null;
    blockNumber: number | null;
  };
  staking: {
    tmaxMonths: number;
    mmax: number;
    permanentMultiplier: number;
    rewardToken: Asset;
  };
  caption: string;
  source: string;
  updatedAt: string;
}

const ASSET_COLOR: Record<Asset, string> = {
  SLVR: "--color-apr",
  ETH: "--color-price",
};

function AssetBadge({ asset }: { asset: Asset }) {
  const color = `var(${ASSET_COLOR[asset]})`;
  return (
    <span
      style={{
        fontSize: "0.625rem",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "1px 7px",
        fontWeight: 700,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
      }}
    >
      earns {asset}
    </span>
  );
}

function ReliabilityTag({ o }: { o: EarnOption }) {
  const isLive = o.reliability === "live_volatile";
  const color = isLive ? "var(--color-stale)" : "var(--color-silver-400)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: "0.625rem",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: color,
          display: "inline-block",
          opacity: 0.9,
        }}
      />
      {o.reliabilityLabel}
    </span>
  );
}

/** One earning option as a ranked card row. */
function EarnRow({ o }: { o: EarnOption }) {
  const accent = `var(${ASSET_COLOR[o.asset]})`;
  const featured = o.rank === 1;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr)",
        gap: 16,
        alignItems: "start",
        padding: "18px 18px",
        borderBottom: "1px solid var(--color-silver-800)",
      }}
    >
      {/* Rank + headline block */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
          minWidth: 132,
          borderLeft: `2px solid ${accent}`,
          paddingLeft: 14,
        }}
      >
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 700,
            letterSpacing: "0.09em",
            color: "var(--color-silver-400)",
            textTransform: "uppercase",
          }}
        >
          #{o.rank}
          {featured && (
            <span style={{ color: accent, marginLeft: 6 }}>· top yield</span>
          )}
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: "1.6rem",
            fontWeight: 700,
            color: "var(--color-silver-100)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.05,
          }}
        >
          {o.headline.display}
        </span>
        <span
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-silver-400)",
            lineHeight: 1.35,
            maxWidth: 150,
          }}
        >
          {o.headlineNote}
        </span>
      </div>

      {/* Name, tags, how-to */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--color-silver-100)",
            }}
          >
            {o.name}
          </span>
          <AssetBadge asset={o.asset} />
          <ReliabilityTag o={o} />
        </div>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--color-silver-300)",
            lineHeight: 1.55,
            margin: 0,
            maxWidth: "68ch",
          }}
        >
          {o.howTo}
        </p>
      </div>
    </div>
  );
}

export default function EarnView() {
  const { data, error, isLoading } = useSWR<EarnResponse>("/api/earn", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });

  const failed = !!error;

  if (failed) {
    return (
      <Panel title="Ways to earn">
        <StateMessage
          tone="error"
          title="Earn comparison unavailable"
          detail="Could not load the dividends snapshot or staking multipliers. This refreshes automatically."
          height={240}
        />
      </Panel>
    );
  }

  const dividends = data?.options.find((o) => o.track === "dividends");
  const staking = data?.options.filter((o) => o.track === "staking") ?? [];

  return (
    <>
      {/* Ranked list */}
      <Panel
        title="Ranked by earning potential"
        note="highest yield first · read each row's asset + reliability"
        flush
      >
        {isLoading && !data ? (
          <div style={{ padding: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded"
                style={{
                  height: 84,
                  margin: 10,
                  backgroundColor: "var(--color-silver-800)",
                  animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
                }}
              />
            ))}
          </div>
        ) : (
          <div>
            {(data?.options ?? []).map((o) => (
              <EarnRow key={o.key} o={o} />
            ))}
          </div>
        )}
      </Panel>

      {/* Two-track explainer */}
      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <div
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--color-silver-800)",
            backgroundColor: "var(--color-silver-900)",
            borderLeft: "2px solid var(--color-apr)",
            padding: "16px 18px",
          }}
        >
          <div
            style={{
              fontSize: "0.6875rem",
              fontWeight: 700,
              color: "var(--color-apr)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Track 1 — Mining Dividends (SLVR)
          </div>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--color-silver-300)",
              lineHeight: 1.6,
            }}
          >
            The single highest headline yield, paid in <strong>SLVR</strong>. Mine
            via Grid Mining and leave your rewards <em>unclaimed</em> — a refining
            fee from other miners&apos; claims is redistributed to unclaimed
            holders. The figure is the{" "}
            <a
              href="/methodology"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              trailing-24h Dividends APR
            </a>
            : real and live, but early and volatile on a young accumulator.
            {dividends && dividends.headline.value !== null && (
              <>
                {" "}
                Currently{" "}
                <strong style={{ color: "var(--color-silver-100)" }}>
                  {dividends.headline.display}
                </strong>{" "}
                APR.
              </>
            )}
          </p>
        </div>

        <div
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--color-silver-800)",
            backgroundColor: "var(--color-silver-900)",
            borderLeft: "2px solid var(--color-price)",
            padding: "16px 18px",
          }}
        >
          <div
            style={{
              fontSize: "0.6875rem",
              fontWeight: 700,
              color: "var(--color-price)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Track 2 — veSLVR Staking (ETH)
          </div>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--color-silver-300)",
              lineHeight: 1.6,
            }}
          >
            Lock SLVR to earn protocol revenue paid in <strong>ETH</strong>,
            split by voting weight. Longer locks earn a bigger weight —{" "}
            <strong>
              {(staking.at(-1)?.multiplier ?? 1.01).toFixed(2)}×
            </strong>{" "}
            for 1 day up to{" "}
            <strong>{(data?.staking.mmax ?? 2.5).toFixed(2)}×</strong> at the{" "}
            {data?.staking.tmaxMonths ?? 4}-month max, and{" "}
            <strong style={{ color: "var(--color-silver-100)" }}>
              {(data?.staking.permanentMultiplier ?? 4).toFixed(2)}×
            </strong>{" "}
            for a permanent lock. We show the exact reward-weight multiplier, not an
            ETH %: the reward asset differs from what&apos;s staked and the rate is
            newly live, so it isn&apos;t reliably annualizable.{" "}
            <a
              href="/staking"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              See staking →
            </a>
          </p>
        </div>
      </div>

      {/* Honest comparability caption */}
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--color-silver-400)",
          marginTop: 4,
          lineHeight: 1.6,
        }}
      >
        {data?.caption ??
          "Mining Dividends (SLVR) and staking (ETH) aren't directly comparable — this ranks earning potential within each track."}{" "}
        Source: live <code style={{ fontFamily: "var(--font-mono)" }}>dividends_apr</code>{" "}
        snapshot + on-chain <code style={{ fontFamily: "var(--font-mono)" }}>TMAX / MMAX / P</code>.
        Refreshed every 60s.
      </p>
    </>
  );
}
