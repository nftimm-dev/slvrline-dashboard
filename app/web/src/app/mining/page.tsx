import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import LotteryView from "@/components/lottery/LotteryView";
import UnclaimedMinersSection from "@/components/mining/UnclaimedMinersSection";
import { SlvrlineActions } from "@/components/common/SlvrlineActionLink";

export const metadata: Metadata = {
  title: "Grid Mining",
  description:
    "Live Grid Mining snapshot on Robinhood Chain: current round, jackpot in ETH, unclaimed rewards pool, cumulative refined, and the miner index.",
  alternates: {
    canonical: "/mining",
  },
};

export default function MiningPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Grid Mining"
          subtitle="The live mining engine for SLVR. A snapshot of the current round, jackpot, and the reward pools that drive dividends."
          aside={<SlvrlineActions actions={["autoStaking", "mining"]} />}
        />
        <LotteryView />
        <UnclaimedMinersSection />
      </PageContainer>
    </main>
  );
}
