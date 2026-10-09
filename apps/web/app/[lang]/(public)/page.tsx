import { StatisticsBlock } from "@/components/home/statistics-block";
import { PageContainer } from "@/components/layout/page-container";
import { getPlatformStatistics } from "@/lib/dal/statistics";

export default async function Home() {
  const tiles = await getPlatformStatistics();

  return (
    <PageContainer layout="page" className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">
          The Global Workforce Network
        </h1>
        <p className="text-lg">Your Workforce. Your Network. One Platform.</p>
      </div>
      {tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null}
    </PageContainer>
  );
}
