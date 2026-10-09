import { Suspense } from "react";
import { StatisticsBlock } from "@/components/home/statistics-block";
import { PageContainer } from "@/components/layout/page-container";
import { getPlatformStatistics } from "@/lib/dal/statistics";

async function Statistics() {
  const tiles = await getPlatformStatistics();
  return tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null;
}

export default function Home() {
  return (
    <PageContainer layout="page" className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">
          The Global Workforce Network
        </h1>
        <p className="text-lg">Your Workforce. Your Network. One Platform.</p>
      </div>
      <Suspense fallback={null}>
        <Statistics />
      </Suspense>
    </PageContainer>
  );
}
