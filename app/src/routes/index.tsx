import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/hero/hero";
import FleetSection from "../components/landing/fleet-section";
import ValuesStack from "../components/landing/values-stack";
import Testimonials from "../components/landing/testimonials";
import FounderTeaser from "../components/landing/founder-teaser";

export const Route = createFileRoute("/")({
  // The home page inherits the app's editable page metadata from the root
  // route, so a shared link to "/" shows the owner's values.
  component: Index,
});

function Index() {
  return (
    <main>
      <Hero />
      <FleetSection />
      <ValuesStack />
      <Testimonials />
      <FounderTeaser />
    </main>
  );
}
