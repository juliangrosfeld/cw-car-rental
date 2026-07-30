import { createFileRoute } from "@tanstack/react-router";

import SectionStub from "../../../components/admin/section-stub";

export const Route = createFileRoute("/admin/_shell/clients")({
  head: () => ({ meta: [{ title: "Clients | CW back office" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { admin } = Route.useRouteContext();
  return (
    <SectionStub
      admin={admin}
      title="Clients"
      subtitle="Guests, their details and their history"
      summary="One row per guest, with every rental they have taken. There is deliberately no unique constraint on email, because one address can legitimately cover several drivers — a couple, or a travel agent booking for clients — so duplicates are expected and merging them is a job for this page rather than something the database should have refused."
      planned={[
        "Searchable directory with rental history and lifetime value",
        "Edit contact details, licence number and expiry",
        "Merge duplicate guest records created by shared email addresses",
        "Flag a licence that expires before the return date",
      ]}
    />
  );
}
