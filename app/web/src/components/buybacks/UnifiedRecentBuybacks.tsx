"use client";

import useSWR from "swr";
import Panel from "@/components/analytics/Panel";
import DataTable, { type Column } from "@/components/analytics/DataTable";
import StateMessage from "@/components/analytics/StateMessage";
import type { BuybackData } from "@/lib/buybacks";
import type { GrowthFundRecent } from "@/lib/growthFund";

/** Shape of GET /api/growthfund/recent — live flywheel buys, no heavy totals. */
interface GfRecentResponse {
  recent: GrowthFundRecent[];
  ethUsd: number | null;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

const usd2 = (n: number | null) =>
  n == null ? "—" : `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type Kind = "burn" | "flywheel";
interface Row {
  ts: number;
  kind: Kind;
  eth: number;
  slvr: number;
  usd: number | null;
}

const KIND_META: Record<Kind, { label: string; color: string; bg: string }> = {
  burn: { label: "Buyback + Burn", color: "#fca5a5", bg: "rgba(239,71,111,0.12)" },
  flywheel: { label: "Growth Flywheel", color: "#6ee7b7", bg: "rgba(52,211,153,0.12)" },
};

function TypeBadge({ kind }: { kind: Kind }) {
  const m = KIND_META[kind];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.6875rem",
        fontWeight: 600,
        color: m.color,
        backgroundColor: m.bg,
        borderRadius: "var(--radius-chip)",
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {m.label}
    </span>
  );
}

const columns: Column<Row>[] = [
  {
    key: "when",
    header: "When",
    render: (r) => <span style={{ color: "var(--color-silver-300)" }}>{relTime(r.ts)}</span>,
  },
  {
    key: "type",
    header: "Type",
    render: (r) => <TypeBadge kind={r.kind} />,
  },
  {
    key: "usd",
    header: "USD spent",
    align: "right",
    mono: true,
    render: (r) => (
      <div>
        <div style={{ color: "var(--color-silver-100)" }}>{usd2(r.usd)}</div>
        <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-500)" }}>
          {r.eth.toFixed(5)} ETH
        </div>
      </div>
    ),
  },
  {
    key: "slvr",
    header: "SLVR",
    align: "right",
    mono: true,
    render: (r) => (
      <div>
        <div style={{ color: r.kind === "burn" ? "var(--color-apr)" : "#34d399" }}>
          {r.slvr.toFixed(4)}
        </div>
        <div style={{ fontSize: "0.6875rem", color: "var(--color-silver-500)" }}>
          {r.kind === "burn" ? "burned" : "bought"}
        </div>
      </div>
    ),
  },
];

export default function UnifiedRecentBuybacks() {
  const { data: burn, error: burnErr, isLoading: burnLoading } = useSWR<BuybackData>(
    "/api/buybacks",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );
  const { data: gf, error: gfErr } = useSWR<GfRecentResponse>("/api/growthfund/recent", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });

  const burnEthUsd = burn?.ethUsd ?? null;
  const gfEthUsd = gf?.ethUsd ?? null;

  const rows: Row[] = [
    ...(burn?.recent ?? []).map((e) => ({
      ts: e.approxTs,
      kind: "burn" as const,
      eth: e.eth,
      slvr: e.slvr,
      usd: burnEthUsd ? e.eth * burnEthUsd : null,
    })),
    ...(gf?.recent ?? []).map((e) => ({
      ts: Date.parse(e.ts),
      kind: "flywheel" as const,
      eth: e.eth,
      slvr: e.slvr,
      usd: gfEthUsd ? e.eth * gfEthUsd : null,
    })),
  ]
    .filter((r) => Number.isFinite(r.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 150);

  const failed = !!burnErr && !!gfErr;
  const loading = burnLoading && !burn && !gf;

  return (
    <div style={{ marginTop: 32 }}>
      <Panel
        title="Recent buybacks"
        note="both streams · protocol burn + Growth Fund flywheel · newest first"
        flush
      >
        {failed ? (
          <StateMessage
            tone="error"
            title="Buyback activity unavailable"
            detail="Could not load recent buyback events. This panel refreshes automatically."
            height={200}
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={rows}
            rowKey={(r, i) => `${r.kind}-${r.ts}-${i}`}
            loading={loading}
            skeletonRows={10}
            emptyMessage="No buybacks recorded yet"
            maxHeight={520}
          />
        )}
      </Panel>
    </div>
  );
}
