"use client";

import { useVitals } from "@/hooks/useVitals";
import { formatUSD } from "@/lib/format";

export default function PriceDisplay() {
  const { data } = useVitals();
  const price = data?.price ?? null;

  return (
    <section className="mb-10">
      <div className="flex justify-between items-center mb-4">
        <h2
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--color-silver-200)",
          }}
        >
          SLVR Price
        </h2>
      </div>
      <div
        className="p-4 border"
        style={{
          borderRadius: "var(--radius-card)",
          borderColor: "var(--color-silver-800)",
          backgroundColor: "var(--color-silver-900)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                color: "var(--color-price)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {price?.slvr_usd != null ? formatUSD(price.slvr_usd) : "—"}
            </div>
            <div
              style={{ fontSize: "0.75rem", color: "var(--color-silver-400)" }}
            >
              per SLVR
            </div>
          </div>

          {price?.slvr_eth != null && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-chip)",
                backgroundColor: "var(--color-silver-800)",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: "0.875rem",
                  color: "var(--color-silver-200)",
                }}
              >
                {price.slvr_eth.toFixed(6)} ETH
              </div>
              {price.eth_usd != null && (
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-silver-400)",
                  }}
                >
                  ETH = {formatUSD(price.eth_usd)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <p style={{ fontSize: "0.75rem", color: "var(--color-silver-400)" }}>
            Historical OHLC chart coming in v1.1 — live data from{" "}
            <a
              href="https://dexscreener.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)", textDecoration: "none" }}
            >
              Dexscreener
            </a>
            .
          </p>
          <p style={{ fontSize: "0.6875rem", color: "var(--color-silver-400)" }}>
            {/* TODO(price-history): Add OHLC chart when Dexscreener OHLC endpoint is available for this token */}
            Price sourced from SLVR/WETH liquidity pool on Robinhood Chain.
          </p>
        </div>
      </div>
    </section>
  );
}
