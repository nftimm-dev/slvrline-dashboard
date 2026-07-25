import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import StakingView from "@/components/staking/StakingView";

export const metadata: Metadata = {
  title: "Staking — SLVRline",
  description:
    "veSLVR staking on Robinhood Chain: total locked, permanent vs time-locked split, lock-size distribution, and top lockers — reconstructed from on-chain state.",
};

export default function StakingPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Staking"
          subtitle="veSLVR vote-escrow locks, read directly from on-chain state. Permanent locks burn the underlying SLVR; time-locked positions decay toward unlock."
        />
        <StakingView />
      </PageContainer>
    </main>
  );
}
