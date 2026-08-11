import { createFileRoute } from "@tanstack/react-router";
import BookingWizard from "../components/booking/wizard";
import { DISCOUNT_TIER_SUMMARY, MIN_RENTAL_DAYS } from "../lib/booking/rental";
import { CURRENCY_CODE } from "../lib/money";

interface BookingSearch {
  car?: string;
}

export const Route = createFileRoute("/booking")({
  validateSearch: (search: Record<string, unknown>): BookingSearch => ({
    car: typeof search.car === "string" ? search.car : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Book your car | CW" },
      {
        name: "description",
        content:
          "Pick your dates, pick your ride, and CW meets you with the keys. Booking a car in Curaçao takes two minutes.",
      },
    ],
  }),
  component: BookingPage,
});

function BookingPage() {
  const { car } = Route.useSearch();
  return (
    <main className="min-h-dvh bg-[#f5f8f8] pt-[72px]">
      <div className="mx-auto max-w-[1160px] px-5 pb-24 pt-12 md:px-8 md:pt-16">
        <h1 className="text-center font-display text-[clamp(1.9rem,3.4vw,2.8rem)] font-extrabold tracking-tight text-cw-navy">
          Book your car
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-center text-[15px] leading-relaxed text-cw-ink/75">
          Two minutes, six steps, zero paperwork at pickup.
        </p>
        {/* The price rules a guest needs BEFORE they start picking days: what
            currency, the shortest rental we take, and what length earns. All
            three come from the pricing module the server quotes from. */}
        <p className="mx-auto mt-4 max-w-[62ch] rounded-xl bg-white px-5 py-3 text-center text-sm leading-relaxed text-cw-ink/80 shadow-[0_2px_10px_rgba(2,48,71,0.06)]">
          <span className="font-semibold text-cw-navy">
            All prices in {CURRENCY_CODE}. Minimum rental {MIN_RENTAL_DAYS} days.
          </span>{" "}
          Longer stays save more: {DISCOUNT_TIER_SUMMARY}. Renting for a month? Pick the monthly
          rate on the first step.
        </p>
        <div className="mt-10">
          <BookingWizard initialCarId={car} />
        </div>
      </div>
    </main>
  );
}
