import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/pages/landing-page";

export const Route = createFileRoute("/")({
  component: LandingPage,
});
