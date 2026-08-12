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
 * see a car as free. The actual guarantee is the
 * `bookings_no_double_booking_vehicle` exclusion constraint in Postgres, which
 * fails the losing INSERT with SQLSTATE 23P01. This module surfaces that as a
 * typed `date_conflict` result rather than a 500. Never "fix" a conflict by
 * pre-checking harder — the constraint is the thing that actually holds.
 *
 * LISTINGS vs VEHICLES (migration 0005) — the distinction this whole module now
 * turns on:
 *
 *   A guest books a LISTING ("the Chevrolet Spark"). Availability is therefore
 *   asked at the listing level: free if ANY vehicle under it has the dates
 *   open. Hidden backup units count — they are capacity, not a separate
 *   product, and excluding them would hide a car that is genuinely free.
 *
 *   A booking holds a VEHICLE. The exclusion constraint keys on vehicle_id, so
 *   two guests CAN hold the Spark listing over the same week when there are two
 *   Sparks, and CANNOT ever hold the same physical car.
 *
 *   Assignment happens at write time, visible unit first — see
 *   `assignVehicle` below for why that preference is not cosmetic and how the
 *   loop stays safe under a race.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import type { Booking, Car, Client, NewBooking, Vehicle } from "../supabase/types";
import {
  PICKUP_TIME,
  RETURN_TIME,
  addDaysToKey,
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

/* ── the fleet, as capacity ─────────────────────────────────────────────────
 *
 * Everything below reasons over VEHICLES and answers about LISTINGS. The shape
 * that makes that readable is one query for the vehicles that are on the road
 * and one for the bookings that hold them, joined in memory: the fleet is six
 * rows, and a PostgREST join would still have to be regrouped here anyway.
 */

/** A vehicle as availability cares about it: whose listing, and is it the one
 *  in the photo. Ordered by ASSIGNMENT PREFERENCE wherever it appears as a
 *  list — see orderByPreference. */
type CandidateVehicle = Pick<
  Vehicle,
  "id" | "listing_id" | "is_publicly_visible" | "color" | "plate_number" | "created_at"
>;

const CANDIDATE_SELECT = "id, listing_id, is_publicly_visible, color, plate_number, created_at";

/**
 * The order vehicles are handed out in.
 *
 * VISIBLE FIRST, and this is not cosmetic: the listing's photo is of that
 * specific car, so a guest who booked from a picture of a black Spark should be
 * given the black Spark whenever it is free. A backup goes out only when the
 * advertised one is already spoken for — which is the whole reason it exists.
 *
 * `created_at` then `id` break the tie deterministically. Determinism matters
 * more than which one wins: two servers assigning from the same free set must
 * pick the same car, or they race each other into an exclusion violation that
 * neither needed to hit.
 */
function orderByPreference(a: CandidateVehicle, b: CandidateVehicle): number {
  if (a.is_publicly_visible !== b.is_publicly_visible) return a.is_publicly_visible ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** Every vehicle on the road, in assignment order. Off-road units are absent
 *  entirely: a car in the shop is not capacity. */
async function loadRoadworthyVehicles(listingId?: string): Promise<CandidateVehicle[]> {
  let query = supabaseAdmin().from("vehicles").select(CANDIDATE_SELECT).eq("status", "available");
  if (listingId) query = query.eq("listing_id", listingId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load vehicles: ${error.message}`);
  return ((data ?? []) as CandidateVehicle[]).sort(orderByPreference);
}

/** Vehicle ids holding a booking that overlaps this window. Half-open overlap:
 *  existing.pickup < new.return AND existing.return > new.pickup — the same
 *  test the exclusion constraint applies, against the same generated columns,
 *  so this read and that write can only disagree by timing. */
async function vehiclesTakenIn(window: RentalWindow): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select("vehicle_id")
    .neq("booking_status", OCCUPYING)
    .lt("pickup_at", toTimestamp(window.returnDate, RETURN_TIME))
    .gt("return_at", toTimestamp(window.pickupDate, PICKUP_TIME));

  if (error) throw new Error(`Failed to load bookings: ${error.message}`);
  return new Set((data ?? []).map((b) => b.vehicle_id));
}

/**
 * Every LISTING with at least one vehicle free for this window.
 *
 * A listing backed by two cars stays on this list while either is free, which
 * is the behaviour the whole split exists for: booking the visible Spark must
 * not take the Spark listing off the site while a second Spark sits idle.
 */
export async function findAvailableCars(window: RentalWindow): Promise<Car[]> {
  assertValidWindow(window);

  const [{ data: cars, error: carsError }, vehicles, taken] = await Promise.all([
    supabaseAdmin().from("cars").select("*").order("daily_rate", { ascending: false }),
    loadRoadworthyVehicles(),
    vehiclesTakenIn(window),
  ]);

  if (carsError) throw new Error(`Failed to load cars: ${carsError.message}`);

  const freeListings = new Set(vehicles.filter((v) => !taken.has(v.id)).map((v) => v.listing_id));
  return (cars ?? []).filter((c) => freeListings.has(c.id));
}

/** Every listing with a car on the road, regardless of dates — the fleet the
 *  calendar reasons over. A listing whose only vehicle is in the shop is absent,
 *  exactly as a car at 'maintenance' used to be. */
export async function listBookableCars(): Promise<Car[]> {
  const [{ data, error }, vehicles] = await Promise.all([
    supabaseAdmin().from("cars").select("*").order("daily_rate", { ascending: false }),
    loadRoadworthyVehicles(),
  ]);
  if (error) throw new Error(`Failed to load cars: ${error.message}`);

  const backed = new Set(vehicles.map((v) => v.listing_id));
  return (data ?? []).filter((c) => backed.has(c.id));
}

/**
 * Dates a LISTING cannot be booked on at all, from today to `horizonDate`, for
 * painting the calendar.
 *
 * WHY THIS IS COMPUTED HERE AND NOT SENT AS RAW BOOKINGS. Before 0005 a busy
 * range was simply a booking: one car, one row, and the browser could test
 * overlap directly. With pooled units that is no longer true — the Spark is
 * unavailable only on days when BOTH Sparks are out — so the arithmetic moves
 * server-side and what goes to the browser is the answer rather than the
 * ingredients.
 *
 * That is also the privacy-preserving shape. The payload says "this listing
 * cannot be booked these days" and nothing else: not how many cars back it, not
 * which one is out, not that a hidden unit exists at all. A per-vehicle payload
 * would have leaked the fleet's real size to anyone reading the network tab.
 *
 * Ranges are half-open [pickupDate, returnDate) to match the day model in
 * ./rental, so the client-side helpers (carFreeForRange, dayFullyBooked) work
 * on them unchanged.
 */
export async function findBusyRanges(fromDate: string, horizonDate: string): Promise<BusyRange[]> {
  const [vehicles, { data: bookings, error }] = await Promise.all([
    loadRoadworthyVehicles(),
    supabaseAdmin()
      .from("bookings")
      .select("vehicle_id, pickup_date, return_date")
      .neq("booking_status", OCCUPYING)
      .gte("return_date", fromDate)
      .lte("pickup_date", horizonDate),
  ]);

  if (error) throw new Error(`Failed to load bookings: ${error.message}`);

  const occupiedByVehicle = new Map<string, { from: string; to: string }[]>();
  for (const b of bookings ?? []) {
    const list = occupiedByVehicle.get(b.vehicle_id);
    const span = { from: b.pickup_date, to: b.return_date };
    if (list) list.push(span);
    else occupiedByVehicle.set(b.vehicle_id, [span]);
  }

  const byListing = new Map<string, CandidateVehicle[]>();
  for (const v of vehicles) {
    const list = byListing.get(v.listing_id);
    if (list) list.push(v);
    else byListing.set(v.listing_id, [v]);
  }

  // Day granular, like the calendar it feeds. A day is occupied for a vehicle
  // when pickup <= day < return — the return day is free, since the car is back
  // that morning.
  const vehicleBusyOn = (vehicleId: string, day: string): boolean =>
    (occupiedByVehicle.get(vehicleId) ?? []).some((s) => s.from <= day && day < s.to);

  const ranges: BusyRange[] = [];

  for (const [listingId, units] of byListing) {
    let runStart: string | null = null;

    // One day past the horizon, so a run that reaches the end is still closed
    // off with an exclusive upper bound rather than being dropped.
    for (let day = fromDate; day <= horizonDate; day = addDaysToKey(day, 1)) {
      const full = units.every((v) => vehicleBusyOn(v.id, day));

      if (full && runStart === null) runStart = day;
      if (!full && runStart !== null) {
        ranges.push({ carId: listingId, pickupDate: runStart, returnDate: day });
        runStart = null;
      }
    }
    if (runStart !== null) {
      ranges.push({
        carId: listingId,
        pickupDate: runStart,
        returnDate: addDaysToKey(horizonDate, 1),
      });
    }
  }

  return ranges;
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
 * Insert a booking against the first vehicle that will actually take it.
 *
 * THIS LOOP IS THE RACE-SAFETY MECHANISM, and it is deliberately built on the
 * write rather than on a better read. `candidates` comes from a check-then-act
 * query, so between reading and writing another request can take any of them.
 * Rather than trying to close that window — which is impossible without a lock
 * the rest of this app does not take — each candidate is simply ATTEMPTED, and
 * a 23P01 from the exclusion constraint is treated as "someone got that one,
 * try the next key on the hook".
 *
 * So two simultaneous requests for a two-Spark listing cannot both be given the
 * black Spark: one insert wins, the loser's constraint violation moves it to the
 * grey one, and both guests end up with a car. Three simultaneous requests and
 * the third runs out of candidates and is told the truth.
 *
 * Any other error is rethrown untouched — a null column or a bad foreign key is
 * a bug, not a busy car, and must not be reported to a guest as "already taken".
 */
async function insertWithAssignment(
  candidates: CandidateVehicle[],
  row: Omit<NewBooking, "vehicle_id">,
): Promise<{ booking: Booking; vehicle: CandidateVehicle } | null> {
  const db = supabaseAdmin();

  for (const vehicle of candidates) {
    const { data, error } = await db
      .from("bookings")
      .insert({ ...row, vehicle_id: vehicle.id })
      .select()
      .single();

    if (!error) return { booking: data, vehicle };
    if (error.code !== EXCLUSION_VIOLATION) {
      throw new Error(`Failed to create booking: ${error.message}`);
    }
  }

  return null;
}

/**
 * The one write path for bookings.
 *
 * Order matters: the listing is read FIRST so the price comes from the
 * database, then the client row is created, then the booking. If every vehicle
 * under the listing is taken we return a typed conflict — the client row is
 * left behind deliberately, since a guest who retries with different dates
 * should not have to re-enter their details, and an orphan client row is
 * harmless.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  // The window a monthly rental occupies is DERIVED, not accepted: the guest
  // picks a start day and the period is fixed at MONTHLY_PERIOD_DAYS. Doing this
  // before anything else means the dates that are validated, the dates that are
  // priced and the dates that are written are the same three dates.
  const window = resolveWindow(input.rentalType, input.pickupDate, input.returnDate);
  assertValidWindow(window);
  const db = supabaseAdmin();

  // 1. Authoritative price source. Nothing the browser sent is trusted here.
  //    The LISTING carries the rates; whether anything is actually bookable is
  //    a separate question, answered by its vehicles below.
  const { data: car, error: carError } = await db
    .from("cars")
    .select("*")
    .eq("id", input.carId)
    .maybeSingle();

  if (carError) throw new Error(`Failed to load car: ${carError.message}`);
  if (!car) {
    return {
      ok: false,
      reason: "car_not_bookable",
      message: "That car is not available to book right now.",
    };
  }

  // Every roadworthy unit under this listing, best first. Empty means the whole
  // listing is off the road — the replacement for the old `status` check.
  const fleet = await loadRoadworthyVehicles(car.id);
  if (fleet.length === 0) {
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

  // 3. The booking, against a specific physical car. Which one is decided here
  //    and NOT shown to the guest: they booked a Spark, they are getting a
  //    Spark, and which of the two is an operational detail the CRM cares about.
  //
  //    booking_status/payment_status stay at their opening values — payment is
  //    not integrated yet, so claiming anything else would be a lie.
  const taken = await vehiclesTakenIn(window);
  const candidates = fleet.filter((v) => !taken.has(v.id));

  const assigned = await insertWithAssignment(candidates, {
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
  });

  if (!assigned) {
    return {
      ok: false,
      reason: "date_conflict",
      message: "Someone just booked that car for those dates. Please pick another ride.",
    };
  }
  const booking = assigned.booking;

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
