import { createFileRoute } from "@tanstack/react-router";
import BookingWizard from "../components/booking/wizard";

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
          Two minutes, five steps, zero paperwork at pickup.
        </p>
        <div className="mt-10">
          <BookingWizard initialCarId={car} />
        </div>
      </div>
    </main>
  );
}
