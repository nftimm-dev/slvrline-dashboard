import type { Metadata } from "next";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/analytics/PageHeader";
import HoldersView from "@/components/holders/HoldersView";

export const metadata: Metadata = {
  title: "Holders — SLVRline",
  description:
    "SLVR holder distribution on Robinhood Chain: holder count, top-10 concentration, and ranked balances with protocol-address tagging.",
};

export default function HoldersPage() {
  return (
    <main className="py-10">
      <PageContainer>
        <PageHeader
          title="Holders"
          subtitle="Distribution of SLVR across addresses — how concentrated the token is, and which of the largest holders are protocol contracts."
        />
        <HoldersView />
      </PageContainer>
    </main>
  );
}
