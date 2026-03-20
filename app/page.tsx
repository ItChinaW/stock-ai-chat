import MainLayout from "@/components/main-layout";
import MarketMarquee from "@/components/market-marquee";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketMarquee />
      <main className="flex-1">
        <MainLayout />
      </main>
    </div>
  );
}
