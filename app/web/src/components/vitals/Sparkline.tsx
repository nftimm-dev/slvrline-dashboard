"use client";

interface Props {
  data: number[];
  colorVar: string;
}

/**
 * Faint background sparkline — a "ghost" of the metric's recent trend, anchored
 * to the lower portion of the card behind the number. Dependency-free inline SVG.
 * Renders nothing if there aren't at least 2 finite points.
 */
export default function Sparkline({ data, colorVar }: Props) {
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;

  const W = 100;
  const H = 40;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = W / (pts.length - 1);
  const xy = pts.map(
    (v, i) => [i * step, H - ((v - min) / span) * (H - 3) - 1.5] as const
  );
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "62%",
        pointerEvents: "none",
        opacity: 0.16,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path d={area} fill={`var(${colorVar})`} opacity={0.45} />
        <path
          d={line}
          fill="none"
          stroke={`var(${colorVar})`}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
