"use client";

import { useRef, useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { toBlob } from "html-to-image";
import { SlvrlineActions } from "@/components/common/SlvrlineActionLink";

interface EarnShareCardProps {
  metrics: EarnShareMetric[];
}

type CopyState = "idle" | "copying" | "copied" | "error";
type EarnShareMetric = {
  rank: number;
  label: string;
  value: string;
  asset: "SLVR" | "ETH";
  detail: string;
};

const METRIC_ACCENT: Record<EarnShareMetric["asset"], string> = {
  SLVR: "#a8f0c8",
  ETH: "#7eb8e8",
};

const FALLBACK_METRICS: EarnShareMetric[] = [
  {
    rank: 1,
    label: "LIVE EARNING OPTION",
    value: "LIVE",
    asset: "SLVR",
    detail: "UPDATING NOW",
  },
  {
    rank: 2,
    label: "LIVE EARNING OPTION",
    value: "LIVE",
    asset: "ETH",
    detail: "UPDATING NOW",
  },
];

function SnapshotMetric({
  rank,
  eyebrow,
  value,
  asset,
  detail,
  accent,
}: {
  rank: string;
  eyebrow: string;
  value: string;
  asset: "SLVR" | "ETH";
  detail: string;
  accent: string;
}) {
  return (
    <div className="earn-share-card__metric" style={{ borderColor: accent }}>
      <div className="earn-share-card__metric-heading">
        <span style={{ color: accent }}>{rank}</span>
        <span>{eyebrow}</span>
      </div>
      <div className="earn-share-card__metric-value">{value}</div>
      <div className="earn-share-card__metric-meta">
        <span style={{ color: accent }}>EARNS {asset}</span>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export default function EarnShareCard({
  metrics,
}: EarnShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const displayMetrics =
    metrics.length >= 2 ? metrics.slice(0, 2) : FALLBACK_METRICS;
  const ariaMetricOne = displayMetrics[0];
  const ariaMetricTwo = displayMetrics[1];

  async function copyCardImage() {
    const card = cardRef.current;
    if (
      !card ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === "undefined"
    ) {
      setCopyState("error");
      return;
    }

    setCopyState("copying");

    try {
      const bounds = card.getBoundingClientRect();
      const pngPromise = toBlob(card, {
        backgroundColor: "#07090d",
        cacheBust: true,
        canvasWidth: 1200,
        canvasHeight: 675,
        height: bounds.height,
        pixelRatio: 1,
        skipFonts: true,
        width: bounds.width,
      }).then((blob) => {
        if (!blob) throw new Error("Could not render the share card.");
        return blob;
      });

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngPromise }),
      ]);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 3000);
    }
  }

  const copyLabel =
    copyState === "copying"
      ? "Rendering image…"
      : copyState === "copied"
        ? "Image copied"
        : copyState === "error"
          ? "Copy failed — try Chrome"
          : "Copy image";

  return (
    <section className="mb-8" aria-labelledby="earn-share-card-title">
      <div
        ref={cardRef}
        className="earn-share-card"
        role="img"
        aria-label={`SLVRline earning snapshot: #1 ${ariaMetricOne?.label} ${ariaMetricOne?.value} and #2 ${ariaMetricTwo?.label} ${ariaMetricTwo?.value}`}
      >
        <div className="earn-share-card__grid" aria-hidden />
        <div className="earn-share-card__glow earn-share-card__glow--blue" aria-hidden />
        <div className="earn-share-card__glow earn-share-card__glow--green" aria-hidden />

        <div className="earn-share-card__content">
          <div className="earn-share-card__topline">
            <div className="earn-share-card__brand">
              <img src="/slvrline-logo.png" alt="" />
              <span>ANALYTICS</span>
            </div>
            <div className="earn-share-card__live">
              <span aria-hidden />
              LIVE EARN SNAPSHOT
            </div>
          </div>

          <div>
            <p className="earn-share-card__eyebrow">ROBINHOOD CHAIN · SLVR</p>
            <h2 id="earn-share-card-title">How can I earn the most?</h2>
            <p className="earn-share-card__subtitle">
              Top two live earn options by current ranked APR.
            </p>
          </div>

          <div className="earn-share-card__metrics">
            {displayMetrics.map((metric) => (
              <SnapshotMetric
                key={`${metric.rank}-${metric.label}`}
                rank={`#${metric.rank}`}
                eyebrow={metric.label}
                value={metric.value}
                asset={metric.asset}
                detail={metric.detail}
                accent={METRIC_ACCENT[metric.asset]}
              />
            ))}
          </div>

          <div className="earn-share-card__footer">
            <div className="earn-share-card__visual-actions">
              <span>AUTO-STAKE REWARDS ↗</span>
              <span>MINE SLVR ↗</span>
            </div>
            <div className="earn-share-card__url">slvrline.fun</div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCardImage}
            disabled={copyState === "copying"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#7eb8e87a] bg-[#7eb8e814] px-3.5 py-2 text-[0.8125rem] font-semibold text-[#d8edff] transition hover:-translate-y-px hover:border-[#b4deffbd] hover:bg-[#7eb8e823] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7eb8e880] disabled:cursor-wait disabled:opacity-70"
          >
            {copyState === "copying" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : copyState === "copied" ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            {copyLabel}
          </button>
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-silver-400">
            X-ready PNG · 1200 × 675
          </span>
        </div>

        <SlvrlineActions
          actions={["autoStaking", "mining"]}
          compact={false}
          className="sm:justify-end"
        />
      </div>

      <p className="sr-only">
        The copied image includes the current earning figures and the
        slvrline.fun brand. Action links open slvrline.fun in a new tab.
      </p>
    </section>
  );
}
