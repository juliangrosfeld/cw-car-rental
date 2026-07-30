/**
 * Server-side booking data access. Service role, RLS bypassed — import ONLY
 * from server functions (the `.server.ts` suffix keeps it out of the client
 * bundle).
 *
 * WHY THIS RUNS WITH THE SERVICE ROLE
 * The anon role can no longer insert bookings or clients (see migration
 * 0002_server_side_bookings.sql). This module is the only write path, which is
 * what makes it possible to guarantee the price: `createBooking` reads
 * daily_rate from the database and recomputes the total, ignoring whatever the
 * browser claimed it should be.
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
  quote,
  toTimestamp,
  type BusyRange,
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

export interface CreateBookingInput extends RentalWindow {
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
  days: number;
  perDayCents: number;
  totalCents: number;
  bookingStatus: Booking["booking_status"];
  paymentStatus: Booking["payment_status"];
  createdAt: string;
}

export type CreateBookingResult =
  | { ok: true; confirmation: BookingConfirmation }
  | { ok: false; reason: "car_not_bookable" | "date_conflict"; message: string };

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
  assertValidWindow(input);
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

  const { days, perDayCents, totalCents } = quote(
    car.daily_rate,
    input.pickupDate,
    input.returnDate,
  );

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
      pickup_date: input.pickupDate,
      pickup_time: PICKUP_TIME,
      return_date: input.returnDate,
      return_time: RETURN_TIME,
      pickup_location: input.pickupLocation,
      return_location: input.returnLocation,
      flight_number: input.flightNumber?.trim() || null,
      total_price: totalCents,
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
      days,
      perDayCents,
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
  const days = quote(car.daily_rate, data.pickup_date, data.return_date).days;

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
    days,
    perDayCents: car.daily_rate,
    totalCents: data.total_price,
    bookingStatus: data.booking_status,
    paymentStatus: data.payment_status,
    createdAt: data.created_at,
  };
}
