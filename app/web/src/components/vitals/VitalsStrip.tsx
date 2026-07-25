"use client";

import { useVitals } from "@/hooks/useVitals";
import VitalCard from "./VitalCard";
import {
  formatAPR,
  formatSLVR,
  formatUSD,
  formatRunway,
} from "@/lib/format";

function RefBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5"
      style={{
        backgroundColor: "rgba(200,204,220,0.08)",
        borderRadius: "var(--radius-chip)",
        border: "1px solid var(--color-silver-700)",
      }}
    >
      <span
        style={{
          fontSize: "0.625rem",
          fontWeight: 700,
          color: "var(--color-silver-300)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        V1 reference
      </span>
    </span>
  );
}

function SupplyBar({
  circulating,
  total,
  max,
}: {
  circulating: number;
  total: number;
  max: number;
}) {
  const circulatingPct = Math.min(100, (circulating / max) * 100);
  const totalPct = Math.min(100, (total / max) * 100);
  return (
    <div className="mt-1">
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 4, backgroundColor: "var(--color-silver-800)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${totalPct}%`,
            backgroundColor: "var(--color-silver-700)",
            borderRadius: 999,
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width:
                circulatingPct > 0 && totalPct > 0
                  ? `${(circulatingPct / totalPct) * 100}%`
                  : "0%",
              backgroundColor: "var(--color-supply)",
              borderRadius: 999,
            }}
          />
        </div>
      </div>
      <div
        className="flex justify-between mt-1"
        style={{ fontSize: "0.5625rem", color: "var(--color-silver-400)" }}
      >
        <span>{circulatingPct.toFixed(1)}% circ / 500K</span>
        <span>{totalPct.toFixed(1)}% emitted</span>
      </div>
    </div>
  );
}

export default function VitalsStrip() {
  const { data, isLoading } = useVitals();

  const apr = data?.dividends_apr ?? null;
  const supply = data?.circulating_supply ?? null;
  const staked = data?.total_staked_slvr ?? null;
  const runway = data?.runway_months ?? null;
  const price = data?.price ?? null;

  const aprMeta = apr?.metadata as
    | {
        window_days?: number;
        data_status?: string;
        headline_mode?: string;
        v1_reference_apr?: number;
        v2_live_annualized?: number;
      }
    | null
    | undefined;
  const v1Ref = aprMeta?.v1_reference_apr ?? null;
  const v2Live = aprMeta?.v2_live_annualized ?? apr?.value ?? null;
  // Option C: while V2 is still stabilising after its 22 Jul accumulator reset,
  // headline V1's last stable 7-day rate as a reference rather than the
  // launch-burst number. `apr.value` (true V2 figure) still drives the chart.
  const showV1Ref = aprMeta?.headline_mode === "v1_reference" && v1Ref != null;

  return (
    <section className="pt-8 pb-6">
      {/*
        Mobile: 2-col grid
        APR card: span-2 on mobile, span-1 on sm+
        Price card: span-2 on mobile, span-1 on sm+
        sm: 3-col
        lg: 5-col (all cards inline)
      */}
      <div className="vitals-grid grid gap-3">
        {/* Card 0: Dividends APR */}
        <div className="vitals-apr-col">
          <VitalCard
            label="DIVIDENDS APR"
            primary={
              showV1Ref
                ? `≈${formatAPR(v1Ref)}`
                : apr?.value != null
                ? `≈${formatAPR(apr.value)}`
                : "—"
            }
            secondary={
              showV1Ref ? "V1 pre-migration · 7-day rolling" : "7-day annualized"
            }
            colorVar="--color-apr"
            snapshotAt={apr?.snapshot_at}
            blockNumber={apr?.block_number}
            loading={isLoading && !apr}
            badge={showV1Ref ? <RefBadge /> : undefined}
            subtext={
              showV1Ref
                ? `V2's dividend accumulator reset at the 22 Jul migration, so its live rate (≈${
                    v2Live != null ? formatAPR(v2Live) : "—"
                  }) is a one-off launch burst — not a sustainable yield. Showing V1's last stable 7-day rate; a real V2 figure begins ~29 Jul (see chart below).`
                : undefined
            }
          />
        </div>

        {/* Card 1: SLVR Staked */}
        <div>
          <VitalCard
            label="SLVR STAKED"
            primary={staked?.value != null ? formatSLVR(staked.value) : "—"}
            secondary={
              staked?.value2 != null
                ? `${formatSLVR(staked.value2)} permanent`
                : undefined
            }
            colorVar="--color-staking"
            snapshotAt={staked?.snapshot_at}
            blockNumber={staked?.block_number}
            loading={isLoading && !staked}
          />
        </div>

        {/* Card 2: Supply */}
        <div>
          <VitalCard
            label="SUPPLY"
            primary={supply?.value != null ? formatSLVR(supply.value) : "—"}
            secondary={
              supply?.value2 != null
                ? `${formatSLVR(supply.value2)} total · 500K max`
                : undefined
            }
            colorVar="--color-supply"
            snapshotAt={supply?.snapshot_at}
            blockNumber={supply?.block_number}
            loading={isLoading && !supply}
            badge={
              supply?.value != null && supply?.value3 != null ? (
                <SupplyBar
                  circulating={supply.value}
                  total={supply.value2 ?? supply.value}
                  max={supply.value3}
                />
              ) : undefined
            }
          />
        </div>

        {/* Card 3: Runway */}
        <div>
          <VitalCard
            label="RUNWAY"
            primary={runway?.value != null ? formatRunway(runway.value) : "—"}
            secondary={
              runway?.value2 != null
                ? `${formatSLVR(runway.value2)} remaining`
                : undefined
            }
            colorVar="--color-supply"
            snapshotAt={runway?.snapshot_at}
            blockNumber={runway?.block_number}
            loading={isLoading && !runway}
          />
        </div>

        {/* Card 4: SLVR Price — full width on mobile */}
        <div className="vitals-price-col">
          <VitalCard
            label="SLVR PRICE"
            primary={price?.slvr_usd != null ? formatUSD(price.slvr_usd) : "—"}
            secondary="per SLVR"
            colorVar="--color-price"
            snapshotAt={price?.cached_at}
            loading={isLoading && !price}
          />
        </div>
      </div>

      <style>{`
        .vitals-grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .vitals-apr-col {
          grid-column: span 2;
        }
        .vitals-price-col {
          grid-column: span 2;
        }
        @media (min-width: 640px) {
          .vitals-grid {
            grid-template-columns: repeat(3, 1fr);
          }
          .vitals-apr-col {
            grid-column: span 1;
          }
          .vitals-price-col {
            grid-column: span 1;
          }
        }
        @media (min-width: 1024px) {
          .vitals-grid {
            grid-template-columns: repeat(5, 1fr);
          }
        }
      `}</style>
    </section>
  );
}
