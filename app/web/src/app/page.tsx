import PageContainer from "@/components/layout/PageContainer";
import VitalsStrip from "@/components/vitals/VitalsStrip";
import AprChartSection from "@/components/charts/AprChartSection";
import SupplyChartSection from "@/components/charts/SupplyChartSection";
import StakingChartSection from "@/components/charts/StakingChartSection";
import PriceDisplay from "@/components/charts/PriceDisplay";

export default function Home() {
  return (
    <main>
      <PageContainer>
        {/* Vitals strip — hero section */}
        <VitalsStrip />

        {/* Divider */}
        <div
          style={{
            borderTop: "1px solid var(--color-silver-800)",
            marginBottom: 40,
          }}
        />

        {/* Historical charts — self-contained Client Components */}
        <AprChartSection />
        <SupplyChartSection />
        <StakingChartSection />
        <PriceDisplay />
      </PageContainer>
    </main>
  );
}
