import { CtaSection } from "@/features/landing/cta-section";
import { FeaturesSection } from "@/features/landing/features-section";
import { Footer } from "@/features/landing/footer";
import { HeroSection } from "@/features/landing/hero-section";
import { IntegrationsSection } from "@/features/landing/integrations-section";
import { Nav } from "@/features/landing/nav";

export function LandingPage() {
  return (
    <div className="flex h-screen flex-col overflow-y-auto">
      <Nav />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <IntegrationsSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
