import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import LotteryView from "@/components/lottery/LotteryView";

export const metadata: Metadata = {
  title: "Lottery — SLVRline",
  description:
    "Live GridLottery V2 snapshot on Robinhood Chain: current round, jackpot in ETH, unclaimed rewards pool, cumulative refined, and the miner index.",
};

export default function LotteryPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Grid Lottery"
          subtitle="The live mining engine for SLVR. A snapshot of the current round, jackpot, and the reward pools that drive dividends."
        />
        <LotteryView />
      </PageContainer>
    </main>
  );
}
