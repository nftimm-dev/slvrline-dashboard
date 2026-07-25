import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import MarketsView from "@/components/markets/MarketsView";

export const metadata: Metadata = {
  title: "Markets — SLVRline",
  description:
    "SLVR liquidity and 24h volume across every Dexscreener-indexed pool on Robinhood Chain — Uniswap v2 and v4.",
};

export default function MarketsPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Markets"
          subtitle="SLVR liquidity and trading volume across every indexed pool on Robinhood Chain."
        />
        <MarketsView />
      </PageContainer>
    </main>
  );
}
