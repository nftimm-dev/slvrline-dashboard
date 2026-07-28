import PageContainer from "@/components/layout/PageContainer";
import VitalsStrip from "@/components/vitals/VitalsStrip";
import AprChartSection from "@/components/charts/AprChartSection";
import StakingApyChartSection from "@/components/charts/StakingApyChartSection";
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
        <SupplyChartSection />
        <StakingChartSection />
        <PriceDisplay />
      </PageContainer>
    </main>
  );
}
