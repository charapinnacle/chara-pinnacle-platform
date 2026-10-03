import { PageContainer } from "@/components/layout/page-container";

export default function Home() {
  return (
    <PageContainer className="flex flex-col gap-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        The Global Workforce Network
      </h1>
      <p className="text-lg">Your Workforce. Your Network. One Platform.</p>
    </PageContainer>
  );
}
