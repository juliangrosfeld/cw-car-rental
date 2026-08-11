/**
 * Server-side booking data access. Service role, RLS bypassed — import ONLY
 * from server functions (the `.server.ts` suffix keeps it out of the client
 * bundle).
 *
 * WHY THIS RUNS WITH THE SERVICE ROLE
 * The anon role can no longer insert bookings or clients (see migration
 * 0002_server_side_bookings.sql). This module is the only write path, which is
 * what makes it possible to guarantee the price: `createBooking` reads the
 * rates from the database and recomputes the total, ignoring whatever the
 * browser claimed it should be.
 *
 * That guarantee now covers three things, not one, because there are three ways
 * a crafted request could otherwise pay less than the price list says:
 *   · the RATE — read from the cars row, never accepted from the request;
 *   · the LENGTH DISCOUNT — derived from dates the server resolved, so a client
 *     cannot claim a 15% tier on a four-day rental;
 *   · the RENTAL TYPE — a monthly booking's return date is derived here, so a
 *     request cannot buy a 90-day stay at the one-month rate.
 * All three live in quoteRental() in ./rental, which this module calls with
 * database values only.
 *
 * WHY THE OVERLAP CHECK HERE IS NOT THE SAFETY NET
 * `findAvailableCars` is a READ, so it is check-then-act: two requests can both
 * see a car as free. The actual guarantee is the `bookings_no_double_booking`
 * exclusion constraint in Postgres, which fails the losing INSERT with SQLSTATE
 * 23P01. This module surfaces that as a typed `date_conflict` result rather
 * than a 500. Never "fix" a conflict by pre-checking harder — the constraint is
 * the thing that actually holds.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import type { Booking, Car, Client } from "../supabase/types";
import {
  PICKUP_TIME,
  RETURN_TIME,
  quoteRental,
  rentalDays,
  resolveWindow,
  toTimestamp,
  type BusyRange,
  type QuoteRefusal,
  type RentalType,
} from "./rental";

/** Statuses that still occupy a car. Mirrors the exclusion constraint's
 *  `where (booking_status <> 'cancelled')`. */
const OCCUPYING = "cancelled";

export interface RentalWindow {
  /** 'YYYY-MM-DD' */
  pickupDate: string;
  /** 'YYYY-MM-DD' */
  returnDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidRentalWindowError extends Error {}

/** Validates format and ordering. Throws rather than silently returning "free". */
export function assertValidWindow(w: RentalWindow): void {
  for (const [field, value] of [
    ["pickupDate", w.pickupDate],
    ["returnDate", w.returnDate],
  ] as const) {
    if (!DATE_RE.test(value)) {
      throw new InvalidRentalWindowError(`${field} must be YYYY-MM-DD, got "${value}"`);
    }
  }
  if (w.returnDate <= w.pickupDate) {
    throw new InvalidRentalWindowError(
      `return date (${w.returnDate}) must be after pickup date (${w.pickupDate})`,
    );
  }
}

/** Every car that is on the road and not committed elsewhere for this window.
 *  The Supabase replacement for the old D1 `findAvailableCars`. */
export async function findAvailableCars(window: RentalWindow): Promise<Car[]> {
  assertValidWindow(window);
  const db = supabaseAdmin();

  const [{ data: cars, error: carsError }, { data: taken, error: takenError }] =
    await Promise.all([
      db.from("cars").select("*").eq("status", "available").order("daily_rate", { ascending: false }),
      // Half-open overlap: existing.pickup < new.return AND existing.return > new.pickup.
      // Compares the generated pickup_at / return_at columns, so this is index-backed
      // and identical to what the exclusion constraint tests.
      db
        .from("bookings")
        .select("car_id")
        .neq("booking_status", OCCUPYING)
        .lt("pickup_at", toTimestamp(window.returnDate, RETURN_TIME))
        .gt("return_at", toTimestamp(window.pickupDate, PICKUP_TIME)),
    ]);

  if (carsError) throw new Error(`Failed to load cars: ${carsError.message}`);
  if (takenError) throw new Error(`Failed to load bookings: ${takenError.message}`);

  const takenIds = new Set((taken ?? []).map((b) => b.car_id));
  return (cars ?? []).filter((c) => !takenIds.has(c.id));
}

/** Every bookable car, regardless of dates — the fleet the calendar reasons over. */
export async function listBookableCars(): Promise<Car[]> {
  const { data, error } = await supabaseAdmin()
    .from("cars")
    .select("*")
    .eq("status", "available")
    .order("daily_rate", { ascending: false });
  if (error) throw new Error(`Failed to load cars: ${error.message}`);
  return data ?? [];
}

/**
 * Occupied date ranges from today to `horizonDate`, for painting the calendar.
 *
 * Returns only car_id + the two dates: no guest names, no prices, no notes.
 * This payload is serialised straight to the browser, so it must never carry a
 * field the anon role is not allowed to read.
 */
export async function findBusyRanges(
  fromDate: string,
  horizonDate: string,
): Promise<BusyRange[]> {
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select("car_id, pickup_date, return_date")
    .neq("booking_status", OCCUPYING)
    .gte("return_date", fromDate)
    .lte("pickup_date", horizonDate);

  if (error) throw new Error(`Failed to load bookings: ${error.message}`);
  return (data ?? []).map((b) => ({
    carId: b.car_id,
    pickupDate: b.pickup_date,
    returnDate: b.return_date,
  }));
}

/**
 * Find an existing guest by email, or create one. Email is lowercased on write
 * so the lookup is a plain equality match.
 *
 * REUSE, NOT UPSERT — deliberately. An `upsert(..., { onConflict: 'email' })`
 * would DO UPDATE, so a travel agent booking five cars under one agency address
 * would have each booking overwrite the previous guest's name and phone. Here
 * an existing row is reused as-is and only ever written once; corrections are
 * the CRM's job.
 *
 * The read-then-insert is not atomic: two simultaneous first-time bookings from
 * the same address can both insert, leaving a duplicate client. That is benign
 * (two rows, both correct, mergeable in the CRM) and is the reason this does
 * NOT rely on a unique constraint — a constraint here would instead reject a
 * legitimate booking.
 */
async function findOrCreateClient(input: {
  fullName: string;
  email: string;
  phone: string;
}): Promise<Client> {
  const db = supabaseAdmin();
  const email = input.email.trim().toLowerCase();

  const { data: existing, error: lookupError } = await db
    .from("clients")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError) throw new Error(`Failed to look up client: ${lookupError.message}`);
  if (existing) return existing;

  const { data, error } = await db
    .from("clients")
    .insert({
      full_name: input.fullName.trim(),
      email,
      phone: input.phone.trim(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save client: ${error.message}`);
  return data;
}

export interface CreateBookingInput {
  rentalType: RentalType;
  /** 'YYYY-MM-DD' */
  pickupDate: string;
  /** 'YYYY-MM-DD'. Ignored for a monthly rental, whose period is derived here. */
  returnDate?: string | null;
  carId: string;
  fullName: string;
  email: string;
  phone: string;
  pickupLocation: string;
  returnLocation: string;
  flightNumber?: string | null;
  specialRequests?: string | null;
}

export interface BookingConfirmation {
  bookingId: string;
  car: Pick<Car, "id" | "model" | "color" | "transmission" | "seats" | "photo_url">;
  client: Pick<Client, "full_name" | "email" | "phone">;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  pickupLocation: string;
  returnLocation: string;
  flightNumber: string | null;
  rentalType: RentalType;
  days: number;
  /** Cents. The daily rate for a daily rental, the monthly rate for a monthly
   *  one — whichever the total was built from. */
  rateCents: number;
  /** Cents before the discount. Equals totalCents when none applied. */
  subtotalCents: number;
  discountPct: number;
  discountCents: number;
  totalCents: number;
  bookingStatus: Booking["booking_status"];
  paymentStatus: Booking["payment_status"];
  createdAt: string;
}

export type CreateBookingResult =
  | { ok: true; confirmation: BookingConfirmation }
  | {
      ok: false;
      reason: "car_not_bookable" | "date_conflict" | QuoteRefusal;
      message: string;
    };

/** Postgres exclusion_violation — the double-booking guard firing. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * The one write path for bookings.
 *
 * Order matters: the car is read FIRST so the price comes from the database,
 * then the client row is created, then the booking. If the exclusion constraint
 * rejects the insert we return a typed conflict — the client row is left behind
 * deliberately, since a guest who retries with different dates should not have
 * to re-enter their details, and an orphan client row is harmless.
 */
export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  // The window a monthly rental occupies is DERIVED, not accepted: the guest
  // picks a start day and the period is fixed at MONTHLY_PERIOD_DAYS. Doing this
  // before anything else means the dates that are validated, the dates that are
  // priced and the dates that are written are the same three dates.
  const window = resolveWindow(input.rentalType, input.pickupDate, input.returnDate);
  assertValidWindow(window);
  const db = supabaseAdmin();

  // 1. Authoritative price source. Nothing the browser sent is trusted here.
  const { data: car, error: carError } = await db
    .from("cars")
    .select("*")
    .eq("id", input.carId)
    .maybeSingle();

  if (carError) throw new Error(`Failed to load car: ${carError.message}`);
  if (!car || car.status !== "available") {
    return {
      ok: false,
      reason: "car_not_bookable",
      message: "That car is not available to book right now.",
    };
  }

  // THE price. Rates from the database, dates resolved above, tier derived from
  // the day count — a refusal here (too short, too long to self-serve, no
  // monthly rate on this car) is a thing to tell the guest, not a 500.
  const priced = quoteRental({
    rentalType: input.rentalType,
    rates: { dailyRateCents: car.daily_rate, monthlyRateCents: car.monthly_rate },
    pickupDate: window.pickupDate,
    returnDate: window.returnDate,
  });
  if (!priced.ok) {
    return { ok: false, reason: priced.reason, message: priced.message };
  }
  const quote = priced.quote;

  // 2. Guest record.
  const client = await findOrCreateClient({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
  });

  // 3. The booking. booking_status/payment_status stay at their opening values —
  //    payment is not integrated yet, so claiming anything else would be a lie.
  const { data: booking, error: bookingError } = await db
    .from("bookings")
    .insert({
      client_id: client.id,
      car_id: car.id,
      pickup_date: window.pickupDate,
      pickup_time: PICKUP_TIME,
      return_date: window.returnDate,
      return_time: RETURN_TIME,
      pickup_location: input.pickupLocation,
      return_location: input.returnLocation,
      flight_number: input.flightNumber?.trim() || null,
      total_price: quote.totalCents,
      rental_type: quote.rentalType,
      discount_pct: quote.discountPct,
      discount_cents: quote.discountCents,
      special_requests: input.specialRequests?.trim() || null,
    })
    .select()
    .single();

  if (bookingError) {
    if (bookingError.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        reason: "date_conflict",
        message: "Someone just booked that car for those dates. Please pick another ride.",
      };
    }
    throw new Error(`Failed to create booking: ${bookingError.message}`);
  }

  // 4. Read back through the admin client and shape the confirmation. The anon
  //    role cannot SELECT bookings at all, so this is the only way the guest
  //    ever sees their own reservation.
  return {
    ok: true,
    confirmation: {
      bookingId: booking.id,
      car: {
        id: car.id,
        model: car.model,
        color: car.color,
        transmission: car.transmission,
        seats: car.seats,
        photo_url: car.photo_url,
      },
      client: { full_name: client.full_name, email: client.email, phone: client.phone },
      pickupDate: booking.pickup_date,
      pickupTime: booking.pickup_time,
      returnDate: booking.return_date,
      returnTime: booking.return_time,
      pickupLocation: booking.pickup_location,
      returnLocation: booking.return_location,
      flightNumber: booking.flight_number,
      rentalType: booking.rental_type,
      days: quote.days,
      rateCents: quote.rateCents,
      subtotalCents: quote.subtotalCents,
      discountPct: booking.discount_pct,
      discountCents: booking.discount_cents,
      totalCents: booking.total_price,
      bookingStatus: booking.booking_status,
      paymentStatus: booking.payment_status,
      createdAt: booking.created_at,
    },
  };
}

/**
 * Re-read a booking by id. Used by the confirmation route so a guest can reload
 * the page without losing their reservation details.
 *
 * NOTE: this is an unauthenticated lookup by uuid. A uuid is unguessable, so it
 * is safe against enumeration, but anyone holding the id sees the booking —
 * treat the id as the secret. It deliberately does NOT return admin_notes.
 */
export async function getBookingConfirmation(
  bookingId: string,
): Promise<BookingConfirmation | null> {
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select("*, cars (*), clients (full_name, email, phone)")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load booking: ${error.message}`);
  if (!data) return null;

  const car = data.cars as unknown as Car;
  const client = data.clients as unknown as Pick<Client, "full_name" | "email" | "phone">;

  // Rebuilt from what was STORED, never re-quoted. The rates in `cars` may have
  // moved since; a guest reloading their confirmation must see the price they
  // were given, and the arithmetic must still add up, so the subtotal is
  // reconstructed from the total and the discount rather than from a rate.
  const days = rentalDays(data.pickup_date, data.return_date);
  const subtotalCents = data.total_price + data.discount_cents;
  const rateCents =
    data.rental_type === "monthly" ? data.total_price : Math.round(subtotalCents / days);

  return {
    bookingId: data.id,
    car: {
      id: car.id,
      model: car.model,
      color: car.color,
      transmission: car.transmission,
      seats: car.seats,
      photo_url: car.photo_url,
    },
    client,
    pickupDate: data.pickup_date,
    pickupTime: data.pickup_time,
    returnDate: data.return_date,
    returnTime: data.return_time,
    pickupLocation: data.pickup_location,
    returnLocation: data.return_location,
    flightNumber: data.flight_number,
    rentalType: data.rental_type,
    days,
    rateCents,
    subtotalCents,
    discountPct: data.discount_pct,
    discountCents: data.discount_cents,
    totalCents: data.total_price,
    bookingStatus: data.booking_status,
    paymentStatus: data.payment_status,
    createdAt: data.created_at,
  };
}
