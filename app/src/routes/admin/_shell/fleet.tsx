import { createFileRoute } from "@tanstack/react-router";

import SectionStub from "../../../components/admin/section-stub";

export const Route = createFileRoute("/admin/_shell/fleet")({
  head: () => ({ meta: [{ title: "Fleet | CW back office" }] }),
  component: FleetPage,
});

function FleetPage() {
  const { admin } = Route.useRouteContext();
  return (
    <SectionStub
      admin={admin}
      title="Fleet"
      subtitle="The five cars, their rates and where they are"
      summary="Cars are the one table the public site reads directly, so a change here is live on the booking page immediately: taking a car off the road removes it from every date the guest can pick. Rates are held in cents and quoted at booking time, which means editing a rate never re-prices a reservation that already exists."
      planned={[
        "Edit daily rate, status and photo per car",
        "Take a car off the road for maintenance without touching existing bookings",
        "Per-car calendar of who has it and when",
        "Utilisation and revenue per car, so a car that never earns is visible",
      ]}
    />
  );
}
