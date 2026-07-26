import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import EarnView from "@/components/earn/EarnView";
import { SlvrlineActions } from "@/components/common/SlvrlineActionLink";

export const metadata: Metadata = {
  title: "Earn",
  description:
    "How can I earn the most on SLVR? A ranked comparison of every way to earn — mining dividends (SLVR) and veSLVR staking by lock length (ETH) — with a plain-English how-to for each.",
  alternates: {
    canonical: "/earn",
  },
};

export default function EarnPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="How can I earn the most?"
          subtitle="Every way to earn on SLVR, ranked by earning potential — with a plain-English how-to for each. Mining dividends pay in SLVR; staking pays in ETH, so each track is ranked on its own terms."
          aside={<SlvrlineActions actions={["autoStaking", "mining"]} />}
        />
        <EarnView />
      </PageContainer>
    </main>
  );
}
