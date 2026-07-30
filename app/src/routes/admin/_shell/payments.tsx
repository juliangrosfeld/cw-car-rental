import { createFileRoute } from "@tanstack/react-router";

import SectionStub from "../../../components/admin/section-stub";

export const Route = createFileRoute("/admin/_shell/payments")({
  head: () => ({ meta: [{ title: "Payments | CW back office" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { admin } = Route.useRouteContext();
  return (
    <SectionStub
      admin={admin}
      title="Payments"
      subtitle="Deposits, balances and refunds"
      summary="The payments table already exists and takes signed amounts, so a refund is a negative row rather than a deleted one and the ledger always adds up to what was actually taken. Once this page records real payments, the dashboard's revenue figures move from the bookings table onto this ledger and start reflecting deposits and part-payments instead of whole bookings."
      planned={[
        "Record a cash, card or transfer payment against a booking",
        "Deposit and balance split, with an outstanding figure per booking",
        "Refunds as signed entries, so the net take is never edited away",
        "Stripe checkout for online prepayment, reconciled by webhook",
      ]}
    />
  );
}
