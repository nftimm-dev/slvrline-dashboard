"use client";

import { useVitals } from "@/hooks/useVitals";
import VitalCard from "./VitalCard";
import {
  formatAPR,
  formatSLVR,
  formatUSD,
  formatRunway,
} from "@/lib/format";
import FreshnessChip from "./FreshnessChip";
import { useHistory, type UseHistoryResult } from "@/hooks/useHistory";

function SupplyBar({
  circulating,
  emitted,
  max,
}: {
  circulating: number;
  emitted: number;
  max: number;
}) {
  // Progress toward the 500K emission cap is measured by EMITTED (totalSupply +
  // cumulative burns), NOT totalSupply — burned/permanent-locked SLVR was still emitted
  // from the budget. Circulating is shown as a lighter inset segment of the emitted bar.
  const emittedPct = Math.min(100, (emitted / max) * 100);
  const circulatingPct = Math.min(100, (circulating / max) * 100);
  return (
    <div className="mt-1">
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 4, backgroundColor: "var(--color-silver-800)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${emittedPct}%`,
            backgroundColor: "var(--color-silver-700)",
            borderRadius: 999,
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width:
                circulatingPct > 0 && emittedPct > 0
                  ? `${(circulatingPct / emittedPct) * 100}%`
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
        <span>{emittedPct.toFixed(1)}% mined / 500K</span>
        <span>
          {formatSLVR(emitted)} mined · 500K cap
        </span>
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
  const fresh = apr ?? supply ?? staked ?? runway;

  // Emitted (totalSupply + cumulative burns) comes through circulating_supply.metadata.
  // This — not totalSupply — drives the "% mined / 500K" progress toward the cap.
  const supplyMeta = supply?.metadata as
    | { emitted_human?: number; emitted_pct?: number }
    | null
    | undefined;
  const emittedHuman =
    typeof supplyMeta?.emitted_human === "number" ? supplyMeta.emitted_human : null;

  // Faint background trend for the cards that have a time-series.
  const aprHist = useHistory("dividends_apr", "24h");
  const supHist = useHistory("circulating_supply", "24h");
  const runHist = useHistory("runway_months", "24h");
  const sparkOf = (h: UseHistoryResult): number[] =>
    (h.data?.rows ?? [])
      .map((r) => r.v)
      .filter((v): v is number => v != null && Number.isFinite(v));

  return (
    <section className="pt-8 pb-6">
      {/* Single, global freshness indicator for the whole strip */}
      <div
        className="flex items-center justify-end gap-1.5 mb-3"
        style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)" }}
      >
        <span>Updated</span>
        {fresh?.snapshot_at && (
          <FreshnessChip snapshotAt={fresh.snapshot_at} blockNumber={fresh.block_number} />
        )}
      </div>
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
              apr?.value != null
                ? `≈${formatAPR(apr.value)}`
                : "—"
            }
            secondary="24h rolling · since 22 Jul"
            colorVar="--color-apr"
            snapshotAt={apr?.snapshot_at}
            blockNumber={apr?.block_number}
            loading={isLoading && !apr}
            sparkline={sparkOf(aprHist)}
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
            sparkline={sparkOf(supHist)}
            badge={
              supply?.value != null && supply?.value3 != null ? (
                <SupplyBar
                  circulating={supply.value}
                  emitted={emittedHuman ?? supply.value2 ?? supply.value}
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
            sparkline={sparkOf(runHist)}
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: stretch;
        }
        .vitals-apr-col {
          grid-column: span 2;
        }
        .vitals-price-col {
          grid-column: span 2;
        }
        @media (min-width: 640px) {
          .vitals-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
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
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }
      `}</style>
    </section>
  );
}
