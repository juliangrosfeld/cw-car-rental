/**
 * Fixture bookings for developing and reviewing the CRM. Run from `app/`:
 *
 *   bun run scripts/seed-bookings.ts seed     insert the fixture set
 *   bun run scripts/seed-bookings.ts status   what is in the database now
 *   bun run scripts/seed-bookings.ts clear    remove ONLY the fixtures
 *
 * THIS SCRIPT WRITES TO WHATEVER PROJECT .env POINTS AT, with the service role
 * key, bypassing RLS. There is no staging project: the safety property that makes
 * that acceptable is that every fixture guest's email ends in FIXTURE_DOMAIN, and
 * `clear` deletes bookings by joining to those guests and nothing else. A real
 * booking cannot be caught by it, because a real guest cannot have an address in
 * a reserved-for-testing TLD (`.invalid`, RFC 2606).
 *
 * `seed` refuses to run twice by clearing its own previous set first, so the
 * fixture set is idempotent and re-runnable while you iterate on a screen.
 *
 * WHAT THE SET IS DESIGNED TO EXERCISE — each of these is a case the bookings
 * page gets wrong if it is written naively, so the fixtures are chosen to make a
 * mistake visible on screen rather than to look plausible:
 *   · rentals in every prep status, so the pipeline and queue counts have content
 *   · a rental spanning the month boundary in each direction (clipped bars)
 *   · back-to-back rentals on one car, handing over on the same day (must tile,
 *     not stack into two lanes)
 *   · a cancelled booking overlapping the rental that replaced it (must stack)
 *   · a same-day rental, out and back on one date (must not vanish)
 *   · an overdue return and an unpaid car about to go out (the two rows an
 *     operator most needs to spot)
 *   · a licence that expires before its own rental ends
 *   · a long rental crossing two month boundaries, and bookings in next month
 *     only, so the month navigation has somewhere to go
 *   · a rental at the 3-day minimum, and one in EACH discount tier (7+, 14+,
 *     21+), so a breakdown that forgets to subtract shows up as a wrong total
 *   · a monthly rental, which occupies a car like any other booking but is
 *     priced from a different column entirely
 *
 * The fleet rows themselves are NEVER touched: a car's status is real data an
 * owner may have set, and a fixture script has no business editing it.
 *
 * PRICES ARE NEVER INVENTED: every total goes through quoteRental() with the
 * rates read from the cars table, exactly as the booking flow computes it —
 * discount tiers included. A fixture that the price book refuses is a mistake in
 * this file and fails the run, which is the point: the fixture set cannot drift
 * into prices the real flow could never produce. The one deliberate exception is
 * `legacy`, below.
 */
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  MONTHLY_PERIOD_DAYS,
  quoteRental,
  rentalDays,
  type RentalType,
} from "../src/lib/booking/rental";
import { formatMoney } from "../src/lib/money";
import type { Database, PaymentStatus, PrepStatus, BookingStatus } from "../src/lib/supabase/types";

/** Reserved TLD (RFC 2606). The tag that makes `clear` safe. */
const FIXTURE_DOMAIN = "@fixture.invalid";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!url || !serviceRoleKey) {
  fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
}

const db = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ── the fixture set ───────────────────────────────────────────────────────── */

/** Dates are written as offsets from TODAY so the set stays interesting whenever
 *  it is run — the calendar defaults to the current month, and a set pinned to
 *  fixed dates would be off-screen a month later. */
const today = new Date();
const pad = (n: number) => String(n).padStart(2, "0");

function day(offset: number): string {
  const d = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
  );
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

interface Fixture {
  /** Why this row exists, printed by `seed` so a reviewer can check the screen
   *  against the intent rather than against a list of names. */
  exercises: string;
  guest: {
    name: string;
    phone: string;
    licenseNumber?: string;
    /** Offset in days from today; negative means already expired. */
    licenseExpiryDays?: number;
    country?: string;
    /**
     * Reuse the guest row created by an earlier fixture with the same key,
     * instead of inserting another one. This mirrors what the real booking path
     * does — findOrCreateClient reuses a guest whose email matches — and is how
     * the fixture set grows repeat customers rather than a directory of
     * one-booking strangers.
     */
    reuseKey?: string;
    /**
     * Force an address. Two DIFFERENT guest rows sharing one address is the
     * duplicate case the client page has to surface, and it cannot be built
     * while every address is derived from the name.
     */
    email?: string;
  };
  carId: string;
  /** Defaults to 'daily'. A monthly fixture ignores `returnOffset` — the period
   *  is derived, exactly as the booking flow derives it. */
  rentalType?: RentalType;
  pickupOffset: number;
  returnOffset: number;
  /**
   * Price this one at the plain daily rate and skip the price book's checks.
   *
   * For rentals that could not be taken TODAY but legitimately exist in the
   * history — the same-day hire below predates the 3-day minimum. The CRM has to
   * render them correctly, so the fixture set has to contain one. Every other
   * fixture goes through quoteRental() and a refusal fails the run.
   */
  legacy?: boolean;
  pickupTime?: string;
  returnTime?: string;
  pickupLocation: string;
  returnLocation: string;
  flightNumber?: string;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
  specialRequests?: string;
  adminNotes?: string;
  /**
   * What the payments ledger should say about this booking.
   *
   *   "settled"   one entry for the full amount
   *   "deposit"   a third up front, the balance still owed
   *   "split"     deposit then balance, two entries
   *   "refunded"  taken in full, then handed back — two entries netting zero
   *   "pending"   a transfer said to be on its way, which counts as nothing
   *   "none"      no entries at all
   *
   * Omitted means: settled if payment_status is 'paid', otherwise nothing. That
   * default is what keeps the fixture set free of reconciliation warnings except
   * where one is wanted — see `mismatch` below.
   */
  ledger?: "settled" | "deposit" | "split" | "refunded" | "pending" | "none";
  /** Leave payment_status deliberately disagreeing with the ledger, to exercise
   *  the reconciliation queue. */
  mismatch?: boolean;
}

const AIRPORT = "Hato International Airport (CUR)";
const PUNDA = "Punda office, Willemstad";
const JAN_THIEL = "Jan Thiel Beach";
const PISCADERA = "Piscadera Bay resort";

const FIXTURES: Fixture[] = [
  {
    exercises: "In progress right now, running into next month — 'out' prep, clipped right edge",
    guest: {
      name: "Marieke van Dijk",
      reuseKey: "marieke",
      phone: "+31 6 2244 8890",
      licenseNumber: "NL-8842119",
      licenseExpiryDays: 900,
      country: "Netherlands",
    },
    carId: "hyundai-venue-red",
    pickupOffset: -3,
    returnOffset: 6,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "KL735",
    bookingStatus: "active",
    paymentStatus: "paid",
    prepStatus: "out",
    specialRequests: "Child seat for a two-year-old, please.",
    ledger: "split",
    adminNotes:
      "Child seat fitted and photographed at handover. Small scuff on the rear bumper was already there — photos on file.",
  },
  {
    exercises: "Tomorrow's pickup, still needs prep and STILL UNPAID — the row to spot on a Monday",
    guest: {
      name: "Andre Martis",
      reuseKey: "andre",
      phone: "+599 9 512 8823",
      licenseNumber: "CW-114882",
      licenseExpiryDays: 420,
      country: "Curaçao",
    },
    carId: "mazda-3-grey",
    pickupOffset: 1,
    returnOffset: 5,
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "confirmed",
    paymentStatus: "unpaid",
    prepStatus: "needs_prep",
    specialRequests: "Collecting straight after work, around 17:00 if that is possible.",
    adminNotes: "Local repeat customer, pays cash at the counter. Chase the balance on collection.",
  },
  {
    exercises:
      "Prepped and waiting, collected TODAY — 'ready' prep, and a licence that expires mid-rental",
    guest: {
      name: "Daniel Okonkwo",
      phone: "+1 305 442 9017",
      licenseNumber: "FL-D7724510",
      licenseExpiryDays: 3,
      country: "United States",
    },
    carId: "nissan-versa-red",
    pickupOffset: 0,
    returnOffset: 7,
    pickupTime: "14:30:00",
    returnTime: "11:00:00",
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "AA1517",
    bookingStatus: "confirmed",
    paymentStatus: "paid",
    prepStatus: "ready",
    adminNotes: "Washed and fuelled, keys in the airport lockbox. Flight lands 13:50.",
  },
  {
    exercises:
      "First half of a back-to-back on one car: hands the keys back the day the next guest collects",
    guest: {
      name: "Sofia Ramirez",
      reuseKey: "sofia",
      phone: "+57 310 774 2288",
      licenseNumber: "CO-99231774",
      licenseExpiryDays: 300,
      country: "Colombia",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: -12,
    returnOffset: -5,
    pickupLocation: AIRPORT,
    returnLocation: JAN_THIEL,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
    specialRequests: "Dropping at the apartment in Jan Thiel rather than the office.",
  },
  {
    exercises: "Second half of it — must TILE against the bar above, not stack into a second lane",
    guest: {
      name: "Thomas Bergmann",
      phone: "+49 171 553 9014",
      licenseNumber: "DE-B7741992",
      licenseExpiryDays: 640,
      country: "Germany",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: -5,
    returnOffset: 2,
    pickupLocation: JAN_THIEL,
    returnLocation: AIRPORT,
    flightNumber: "DE1826",
    bookingStatus: "active",
    paymentStatus: "paid",
    prepStatus: "out",
    adminNotes:
      "Collected from Jan Thiel straight after the previous guest dropped it. Quick turnaround, cleaned on site.",
  },
  {
    exercises:
      "Cancelled, overlapping the rental that replaced it — must stack into a second lane, drawn muted",
    guest: {
      name: "Priya Raghunathan",
      phone: "+44 7700 118 245",
      licenseNumber: "UK-RAGHU7712",
      licenseExpiryDays: 700,
      country: "United Kingdom",
    },
    carId: "nissan-versa-silver",
    pickupOffset: -8,
    returnOffset: -1,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "cancelled",
    paymentStatus: "refunded",
    prepStatus: "booked",
    ledger: "refunded",
    adminNotes: "Cancelled two days after booking, trip called off. Deposit refunded in full.",
  },
  {
    exercises: "The rental that took those dates instead, same car, overlapping the cancellation",
    guest: {
      name: "Kevin Statia",
      phone: "+599 9 660 1174",
      licenseNumber: "CW-220981",
      licenseExpiryDays: 380,
      country: "Curaçao",
    },
    carId: "nissan-versa-silver",
    pickupOffset: -7,
    returnOffset: -2,
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
    specialRequests: "Needed the car for a wedding — asked for it spotless.",
  },
  {
    exercises: "OVERDUE: should have been back two days ago and is still marked out",
    guest: {
      name: "Luc Fontein",
      phone: "+599 9 843 2210",
      licenseNumber: "NL-5521904",
      licenseExpiryDays: 500,
      country: "Netherlands",
    },
    carId: "mazda-3-grey",
    pickupOffset: -9,
    returnOffset: -2,
    pickupLocation: PISCADERA,
    returnLocation: PISCADERA,
    bookingStatus: "active",
    paymentStatus: "paid",
    prepStatus: "out",
    adminNotes:
      "Two days overdue. Voicemail and WhatsApp left; an extension is likely but nothing is confirmed.",
  },
  {
    exercises: "Finished and checked in — 'returned' prep on a completed booking",
    guest: {
      name: "Emily Carter",
      reuseKey: "emily",
      phone: "+1 416 778 3320",
      licenseNumber: "ON-C7741208",
      licenseExpiryDays: 1500,
      country: "Canada",
    },
    carId: "hyundai-venue-red",
    pickupOffset: -18,
    returnOffset: -11,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "AC1804",
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
    adminNotes: "Returned clean and full. Wants a quote for two weeks in December.",
  },
  {
    exercises:
      "Same-day rental, out at 08:00 and back at 19:30 — must still draw as one column. LEGACY: taken before the 3-day minimum existed, so the CRM must render a rental the booking flow would now refuse",
    guest: {
      name: "Jurgen Pieters",
      phone: "+599 9 511 7708",
      country: "Curaçao",
    },
    carId: "nissan-versa-red",
    legacy: true,
    pickupOffset: -1,
    returnOffset: -1,
    pickupTime: "08:00:00",
    returnTime: "19:30:00",
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
    specialRequests: "Day trip to Westpunt.",
  },
  {
    exercises:
      "MONTHLY rental crossing two month boundaries — flat monthly rate, no per-day maths, no discount tier on top",
    guest: {
      name: "Isabel Fernández",
      phone: "+34 655 220 913",
      licenseNumber: "ES-4471209",
      licenseExpiryDays: 800,
      country: "Spain",
    },
    carId: "nissan-versa-red",
    rentalType: "monthly",
    pickupOffset: 12,
    returnOffset: 12 + MONTHLY_PERIOD_DAYS,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "IB6501",
    bookingStatus: "confirmed",
    paymentStatus: "pending",
    prepStatus: "booked",
    specialRequests: "Here for a work placement, taking the monthly rate.",
    ledger: "deposit",
    adminNotes:
      "Bank transfer promised before pickup. On the flat monthly rate, not the daily one — do not requote per day if she extends.",
  },
  {
    exercises: "Next month only — absent from this month's calendar, present in the list",
    guest: {
      name: "Robert Nieuwenhuis",
      phone: "+31 6 1188 4420",
      licenseNumber: "NL-7712043",
      licenseExpiryDays: 950,
      country: "Netherlands",
    },
    carId: "mazda-3-grey",
    pickupOffset: 38,
    returnOffset: 45,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "KL735",
    bookingStatus: "pending",
    paymentStatus: "unpaid",
    prepStatus: "booked",
  },
  {
    exercises: "Started LAST month and ended in this one — clipped left edge",
    guest: {
      name: "Gregory Simmons",
      phone: "+1 718 220 4471",
      licenseNumber: "NY-S8841207",
      licenseExpiryDays: 1100,
      country: "United States",
    },
    carId: "hyundai-venue-red",
    pickupOffset: -34,
    returnOffset: -22,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
    mismatch: true,
  },
  {
    exercises: "Repeat customer: Marieke's first rental with CW, four months back",
    guest: {
      name: "Marieke van Dijk",
      reuseKey: "marieke",
      phone: "+31 6 2244 8890",
      licenseNumber: "NL-8842119",
      licenseExpiryDays: 900,
      country: "Netherlands",
    },
    carId: "hyundai-venue-red",
    pickupOffset: -120,
    returnOffset: -113,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "KL735",
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "…and her second, on a different car — three rentals makes her the top repeat guest",
    guest: {
      name: "Marieke van Dijk",
      reuseKey: "marieke",
      phone: "+31 6 2244 8890",
      country: "Netherlands",
    },
    carId: "nissan-versa-red",
    pickupOffset: -75,
    returnOffset: -68,
    pickupLocation: AIRPORT,
    returnLocation: PUNDA,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "Repeat local: Andre's earlier rental",
    guest: {
      name: "Andre Martis",
      reuseKey: "andre",
      phone: "+599 9 512 8823",
      country: "Curaçao",
    },
    carId: "mazda-3-grey",
    pickupOffset: -95,
    returnOffset: -88,
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "…and another, so his record shows three and an unpaid one outstanding",
    guest: {
      name: "Andre Martis",
      reuseKey: "andre",
      phone: "+599 9 512 8823",
      country: "Curaçao",
    },
    carId: "mazda-3-grey",
    pickupOffset: -60,
    returnOffset: -52,
    pickupLocation: PUNDA,
    returnLocation: JAN_THIEL,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "Repeat visitor: Emily's previous trip, on a different car",
    guest: {
      name: "Emily Carter",
      reuseKey: "emily",
      phone: "+1 416 778 3320",
      country: "Canada",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: -110,
    returnOffset: -100,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "Repeat visitor: Sofia's earlier rental",
    guest: {
      name: "Sofia Ramirez",
      reuseKey: "sofia",
      phone: "+57 310 774 2288",
      country: "Colombia",
    },
    carId: "nissan-versa-silver",
    pickupOffset: -50,
    returnOffset: -44,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises:
      "DUPLICATE BY EMAIL: same address as Thomas Bergmann, spelt differently, different phone — the mismatch the client page must surface rather than merge",
    guest: {
      name: "Tomas Bergman",
      email: "thomas.bergmann@fixture.invalid",
      phone: "+49 171 553 9099",
      licenseNumber: "DE-B7741992",
      licenseExpiryDays: 640,
      country: "Germany",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: -70,
    returnOffset: -64,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises:
      "DUPLICATE BY PHONE: Robert's number under a different name and address — matched on the last 8 digits",
    guest: {
      name: "R. Nieuwenhuis",
      phone: "+31 6 1188 4420",
      country: "Netherlands",
    },
    carId: "hyundai-venue-red",
    pickupOffset: -60,
    returnOffset: -55,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises: "EXPIRED licence — they cannot legally drive until it is renewed",
    guest: {
      name: "Wilhelmina Cijntje",
      phone: "+599 9 690 4412",
      licenseNumber: "CW-330214",
      licenseExpiryDays: -20,
      country: "Curaçao",
    },
    carId: "mazda-3-grey",
    pickupOffset: -40,
    returnOffset: -33,
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "completed",
    paymentStatus: "paid",
    prepStatus: "returned",
  },
  {
    exercises:
      "AT THE MINIMUM: exactly 3 days, the shortest rental the flow will take, and NO discount — the row that proves a tier is not applied to everything",
    guest: {
      name: "Naomi Leito",
      phone: "+599 9 522 4417",
      licenseNumber: "CW-441209",
      licenseExpiryDays: 610,
      country: "Curaçao",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: 7,
    returnOffset: 10,
    pickupLocation: PUNDA,
    returnLocation: PUNDA,
    bookingStatus: "confirmed",
    paymentStatus: "paid",
    prepStatus: "booked",
    specialRequests: "Long weekend on the west side.",
  },
  {
    exercises:
      "TIER 2: 14 days, so 10% comes off. Total must be less than 14 x the daily rate everywhere it is shown",
    guest: {
      name: "Hannah Lindqvist",
      phone: "+46 70 442 1180",
      licenseNumber: "SE-7741203",
      licenseExpiryDays: 720,
      country: "Sweden",
    },
    carId: "hyundai-venue-red",
    pickupOffset: 10,
    returnOffset: 24,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "SK1449",
    bookingStatus: "confirmed",
    paymentStatus: "paid",
    prepStatus: "booked",
    specialRequests: "Two weeks, mostly diving. Roof space for tanks would help.",
    adminNotes: "Two week discount applied automatically at booking. Do not discount again by hand.",
  },
  {
    exercises:
      "TIER 3: 24 days, so 15% comes off — and it is still under the 27-day self-service ceiling, which the next one is not",
    guest: {
      name: "Victor Amaral",
      phone: "+55 21 99884 3320",
      licenseNumber: "BR-VA7741992",
      licenseExpiryDays: 480,
      country: "Brazil",
    },
    carId: "chevrolet-spark-black",
    pickupOffset: 20,
    returnOffset: 44,
    pickupLocation: AIRPORT,
    returnLocation: PUNDA,
    flightNumber: "LA8074",
    bookingStatus: "pending",
    paymentStatus: "unpaid",
    prepStatus: "booked",
    ledger: "deposit",
    adminNotes:
      "Three week rate, taken online. Asked whether a fourth week is possible; that is over the online limit, so it needs a custom quote.",
  },
  {
    exercises: "Licence EXPIRING inside the warning window, with a rental booked ahead of it",
    guest: {
      name: "Peter Halvorsen",
      phone: "+47 918 22 447",
      licenseNumber: "NO-4471223",
      licenseExpiryDays: 25,
      country: "Norway",
    },
    carId: "nissan-versa-silver",
    pickupOffset: 14,
    returnOffset: 20,
    pickupLocation: AIRPORT,
    returnLocation: AIRPORT,
    flightNumber: "SK1451",
    bookingStatus: "confirmed",
    paymentStatus: "unpaid",
    prepStatus: "booked",
    specialRequests: "Two child seats if possible.",
    ledger: "pending",
  },
];

/* ── seeding ───────────────────────────────────────────────────────────────── */

function fixtureEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug}${FIXTURE_DOMAIN}`;
}

async function loadCars() {
  const { data, error } = await db
    .from("cars")
    .select("id, model, color, daily_rate, monthly_rate, status");
  if (error) fail(`Could not read the fleet: ${error.message}`);
  if (!data || data.length === 0) fail("No cars in the database — run the migrations first.");
  return new Map(data.map((c) => [c.id, c]));
}

async function findFixtureClientIds(): Promise<string[]> {
  const { data, error } = await db.from("clients").select("id").like("email", `%${FIXTURE_DOMAIN}`);
  if (error) fail(`Could not list fixture guests: ${error.message}`);
  return (data ?? []).map((c) => c.id);
}

async function clear(quiet = false): Promise<{ bookings: number; clients: number }> {
  const clientIds = await findFixtureClientIds();
  if (clientIds.length === 0) {
    if (!quiet) console.log("\n  Nothing to clear — no fixture guests in the database.\n");
    return { bookings: 0, clients: 0 };
  }

  // Bookings first: clients.id is referenced with ON DELETE RESTRICT, so the
  // guest rows cannot go while a booking still points at them. Payments would
  // need the same treatment; the CRM does not write any yet, and this deletes
  // none, so a stray payment row would (correctly) block the clear rather than
  // being silently discarded.
  // Payments first: payments.booking_id is ON DELETE RESTRICT, so a fixture
  // booking with a ledger cannot go while its entries are still there.
  const { data: fixtureBookings, error: findError } = await db
    .from("bookings")
    .select("id")
    .in("client_id", clientIds);
  if (findError) fail(`Could not list fixture bookings: ${findError.message}`);

  const bookingIds = (fixtureBookings ?? []).map((b) => b.id);
  if (bookingIds.length > 0) {
    const { error: paymentsError } = await db
      .from("payments")
      .delete()
      .in("booking_id", bookingIds);
    if (paymentsError) fail(`Could not delete fixture payments: ${paymentsError.message}`);
  }

  const { data: deletedBookings, error: bookingsError } = await db
    .from("bookings")
    .delete()
    .in("client_id", clientIds)
    .select("id");
  if (bookingsError) fail(`Could not delete fixture bookings: ${bookingsError.message}`);

  const { data: deletedClients, error: clientsError } = await db
    .from("clients")
    .delete()
    .in("id", clientIds)
    .select("id");
  if (clientsError) fail(`Could not delete fixture guests: ${clientsError.message}`);

  const counts = {
    bookings: deletedBookings?.length ?? 0,
    clients: deletedClients?.length ?? 0,
  };
  if (!quiet) {
    console.log(
      `\n  ✓ Removed ${counts.bookings} fixture bookings and ${counts.clients} fixture guests.\n`,
    );
  }
  return counts;
}

async function seed() {
  const cars = await loadCars();

  // Re-runnable: drop the previous fixture set first so the exclusion constraint
  // does not reject the same dates on a second run.
  await clear(true);

  /** reuseKey → the client row created for it. */
  const guestsByKey = new Map<string, string>();
  const rows: {
    label: string;
    type: string;
    days: number;
    discount: string;
    total: number;
    pickup: string;
    return: string;
  }[] = [];

  for (const fixture of FIXTURES) {
    const car = cars.get(fixture.carId);
    if (!car) fail(`Fixture references an unknown car: ${fixture.carId}`);

    const rentalType = fixture.rentalType ?? "daily";
    const pickupDate = day(fixture.pickupOffset);
    const returnDate = day(fixture.returnOffset);

    // A repeat customer is one guest row with several bookings, exactly as the
    // booking path produces: the second booking finds the existing row rather
    // than writing a new one.
    let clientId = fixture.guest.reuseKey ? guestsByKey.get(fixture.guest.reuseKey) : undefined;

    if (!clientId) {
      const { data: client, error: clientError } = await db
        .from("clients")
        .insert({
          full_name: fixture.guest.name,
          phone: fixture.guest.phone,
          email: fixture.guest.email ?? fixtureEmail(fixture.guest.name),
          license_number: fixture.guest.licenseNumber ?? null,
          license_expiry:
            fixture.guest.licenseExpiryDays === undefined
              ? null
              : day(fixture.guest.licenseExpiryDays),
          country_of_residence: fixture.guest.country ?? null,
        })
        .select("id")
        .single();
      if (clientError || !client) fail(`Could not create fixture guest: ${clientError?.message}`);

      clientId = client.id;
      if (fixture.guest.reuseKey) guestsByKey.set(fixture.guest.reuseKey, clientId);
    }

    // THE price rule, not a made-up number: the rates from the database through
    // the same quoteRental() the public booking flow uses, tiers and all.
    //
    // A refusal is fatal by design. It means this file describes a rental CW
    // does not sell (too short, past the self-service ceiling, monthly on a car
    // with no monthly rate), and seeding it anyway would put a price in the
    // database that no code path could ever produce.
    let totalCents: number;
    let discountPct = 0;
    let discountCents = 0;

    if (fixture.legacy) {
      // Deliberately outside the price book — see `legacy` on the Fixture type.
      totalCents = car.daily_rate * rentalDays(pickupDate, returnDate);
    } else {
      const priced = quoteRental({
        rentalType,
        rates: { dailyRateCents: car.daily_rate, monthlyRateCents: car.monthly_rate },
        pickupDate,
        returnDate,
      });
      if (!priced.ok) {
        fail(
          `Fixture for ${fixture.guest.name} cannot be priced (${priced.reason}): ${priced.message}` +
            "\n    Fix the offsets in this script, or mark it `legacy` if it is meant to be a " +
            "historical rental the flow would now refuse.",
        );
      }
      totalCents = priced.quote.totalCents;
      discountPct = priced.quote.discountPct;
      discountCents = priced.quote.discountCents;
    }

    const { data: booking, error: bookingError } = await db
      .from("bookings")
      .insert({
        client_id: clientId,
        car_id: fixture.carId,
        pickup_date: pickupDate,
        pickup_time: fixture.pickupTime ?? "10:00:00",
        return_date: returnDate,
        return_time: fixture.returnTime ?? "10:00:00",
        pickup_location: fixture.pickupLocation,
        return_location: fixture.returnLocation,
        flight_number: fixture.flightNumber ?? null,
        total_price: totalCents,
        rental_type: rentalType,
        discount_pct: discountPct,
        discount_cents: discountCents,
        booking_status: fixture.bookingStatus,
        payment_status: fixture.paymentStatus,
        prep_status: fixture.prepStatus,
        special_requests: fixture.specialRequests ?? null,
        admin_notes: fixture.adminNotes ?? null,
      })
      .select("id")
      .single();

    if (bookingError) {
      // 23P01 is the double-booking guard. It firing here means two fixtures
      // overlap on one car, which is a bug in this file, not in the app.
      const hint =
        bookingError.code === "23P01"
          ? "\n    Two fixtures collide on the same car — adjust the offsets in this script."
          : "";
      fail(`Could not create booking for ${fixture.guest.name}: ${bookingError.message}${hint}`);
    }

    // ── the payments ledger ───────────────────────────────────────────────
    // Real bookings accumulate entries as money arrives; fixtures that skipped
    // this would show every paid booking as "marked paid, nothing recorded",
    // which is the reconciliation warning rather than the normal case.
    const recipe =
      fixture.ledger ??
      (fixture.paymentStatus === "paid" && !fixture.mismatch ? "settled" : "none");

    const third = Math.round(totalCents / 3);

    // Entries are BACKDATED to when the money would really have moved. Left at
    // the default now(), every fixture payment would land today and the payments
    // page would show "taken today" equal to "taken all time" — which hides
    // exactly the date bucketing the page is there to do. The offset is written
    // explicitly (-04:00, Curaçao) because created_at is a timestamptz.
    const at = (offsetDays: number, hour = "14:30:00") => `${day(offsetDays)}T${hour}-04:00`;
    // Money for a rental already under way arrives at handover; money for one
    // still ahead was prepaid when it was booked.
    const settledAt =
      fixture.pickupOffset <= 0
        ? at(fixture.pickupOffset, "10:00:00")
        : at(fixture.pickupOffset - 10);
    const depositAt = at(fixture.pickupOffset - 20);

    const entries: { amount: number; method: string; status: string; created_at: string }[] =
      recipe === "settled"
        ? [{ amount: totalCents, method: "card", status: "paid", created_at: settledAt }]
        : recipe === "deposit"
          ? [{ amount: third, method: "cash", status: "paid", created_at: depositAt }]
          : recipe === "split"
            ? [
                { amount: third, method: "bank_transfer", status: "paid", created_at: depositAt },
                {
                  amount: totalCents - third,
                  method: "cash",
                  status: "paid",
                  created_at: settledAt,
                },
              ]
            : recipe === "refunded"
              ? [
                  { amount: totalCents, method: "card", status: "paid", created_at: depositAt },
                  {
                    amount: -totalCents,
                    method: "card",
                    status: "paid",
                    created_at: at(fixture.pickupOffset - 3),
                  },
                ]
              : recipe === "pending"
                ? [
                    {
                      amount: totalCents,
                      method: "bank_transfer",
                      status: "pending",
                      created_at: at(-2),
                    },
                  ]
                : [];

    if (entries.length > 0) {
      const { error: paymentsError } = await db.from("payments").insert(
        entries.map((entry) => ({
          booking_id: booking!.id,
          amount: entry.amount,
          method: entry.method,
          status: entry.status,
          created_at: entry.created_at,
          provider_transaction_id: null,
        })),
      );
      if (paymentsError) {
        fail(
          `Could not record fixture payments for ${fixture.guest.name}: ${paymentsError.message}`,
        );
      }
    }

    rows.push({
      label: `${fixture.guest.name} · ${car.model} ${car.color} · ${fixture.prepStatus}`,
      type: fixture.legacy ? "legacy" : rentalType,
      days: rentalDays(pickupDate, returnDate),
      discount: discountPct > 0 ? `${discountPct}% (${formatMoney(discountCents)})` : "—",
      total: totalCents,
      pickup: pickupDate,
      return: returnDate,
    });
  }

  console.log(`\n  ✓ Seeded ${rows.length} fixture bookings.\n`);
  console.table(
    rows.map((r) => ({
      booking: r.label,
      type: r.type,
      pickup: r.pickup,
      return: r.return,
      days: r.days,
      discount: r.discount,
      total: formatMoney(r.total),
    })),
  );
  console.log("  What each row is here to prove:\n");
  for (const fixture of FIXTURES) {
    console.log(`    · ${fixture.guest.name}: ${fixture.exercises}`);
  }
  console.log(
    `\n  Every guest address ends in ${FIXTURE_DOMAIN}, so:\n` +
      "    bun run scripts/seed-bookings.ts clear\n" +
      "  removes exactly this set and can never touch a real booking.\n",
  );
}

async function status() {
  const fixtureIds = await findFixtureClientIds();

  const [bookings, clients, fixtureBookings] = await Promise.all([
    db.from("bookings").select("*", { count: "exact", head: true }),
    db.from("clients").select("*", { count: "exact", head: true }),
    fixtureIds.length > 0
      ? db.from("bookings").select("*", { count: "exact", head: true }).in("client_id", fixtureIds)
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const real = (bookings.count ?? 0) - (fixtureBookings.count ?? 0);

  console.log("\n  Database contents:\n");
  console.table([
    { rows: "bookings", total: bookings.count ?? 0, fixture: fixtureBookings.count ?? 0, real },
    {
      rows: "clients",
      total: clients.count ?? 0,
      fixture: fixtureIds.length,
      real: (clients.count ?? 0) - fixtureIds.length,
    },
  ]);
  console.log(
    real === 0
      ? "  No real bookings — the database is clean apart from any fixtures above.\n"
      : `  ⚠ ${real} REAL bookings are present. 'clear' will not touch them.\n`,
  );
}

const command = process.argv[2];

if (command === "seed") await seed();
else if (command === "clear") await clear();
else if (command === "status") await status();
else {
  console.log(
    "\n  Usage:\n" +
      "    bun run scripts/seed-bookings.ts seed     insert the fixture set\n" +
      "    bun run scripts/seed-bookings.ts status   show what is in the database\n" +
      "    bun run scripts/seed-bookings.ts clear    remove ONLY the fixtures\n",
  );
  process.exit(command ? 1 : 0);
}
