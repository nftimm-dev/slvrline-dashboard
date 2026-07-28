import PageContainer from "@/components/layout/PageContainer";
import VitalsStrip from "@/components/vitals/VitalsStrip";
import AprChartSection from "@/components/charts/AprChartSection";
import StakingApyChartSection from "@/components/charts/StakingApyChartSection";
import LpStakingApyChartSection from "@/components/charts/LpStakingApyChartSection";
import SupplyChartSection from "@/components/charts/SupplyChartSection";
import StakingChartSection from "@/components/charts/StakingChartSection";
import PriceDisplay from "@/components/charts/PriceDisplay";
import SlvrlineActionRail from "@/components/common/SlvrlineActionRail";

export default function Home() {
  return (
    <main>
      <PageContainer>
        {/* Vitals strip — hero section */}
        <VitalsStrip />

        <SlvrlineActionRail />

        {/* Historical charts — self-contained Client Components */}
        <AprChartSection />
        <StakingApyChartSection />
        <LpStakingApyChartSection
          dataKey="v2"
          title="LP APR — Concentrated"
          subtitle="· Uniswap V4 · tight-range LPs · 24h rolling"
          color="#34d399"
        />
        <LpStakingApyChartSection
          dataKey="v3"
          title="LP APR — Full-range"
          subtitle="· Uniswap V4 · full-range LPs · 24h rolling"
          color="#22d3ee"
        />
        <SupplyChartSection />
        <StakingChartSection />
        <PriceDisplay />
      </PageContainer>
    </main>
  );
}
