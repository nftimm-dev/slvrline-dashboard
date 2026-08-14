import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import BuybacksView from "@/components/buybacks/BuybacksView";
import { SlvrlineActions } from "@/components/common/SlvrlineActionLink";

export const metadata: Metadata = {
  title: "Buybacks",
  description:
    "SLVR buyback-and-burn on Robinhood Chain: a share of mining revenue buys SLVR every ~80s and sends it to the graveyard forever. Cumulative SLVR burned, ETH spent, and the current daily rate.",
  alternates: {
    canonical: "/buybacks",
  },
};

export default function BuybacksPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Buybacks"
          subtitle={
            <>
              Every ~80 seconds a share of mining revenue buys SLVR on the open market and sends it
              to the <strong style={{ color: "var(--color-silver-200)" }}>SLVR Graveyard</strong> —
              removed from circulation forever.
            </>
          }
          aside={<SlvrlineActions actions={["mining", "swapBridge"]} />}
        />
        <BuybacksView />
      </PageContainer>
    </main>
  );
}
