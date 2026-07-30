/**
 * Booking server functions — the browser's entire interface to the database.
 *
 * The anon key can only SELECT cars (migration 0002), so every read of booking
 * data and every write goes through here, where the service-role client runs
 * server-side only.
 *
 * Input validation is zod on every handler. These are public endpoints — the
 * wizard is the intended caller, but anything on the internet can POST to them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createBooking,
  findAvailableCars,
  findBusyRanges,
  getBookingConfirmation,
  listBookableCars,
  InvalidRentalWindowError,
} from "../booking/availability.server";
import { CALENDAR_HORIZON_DAYS, DAY_MS, toKey } from "../booking/rental";
import type { Car } from "../supabase/types";

/** The car fields safe to serialise to the browser. `cars` is anon-readable in
 *  full, so this is shape discipline rather than a security boundary. */
export interface PublicCar {
  id: string;
  model: string;
  category: string;
  color: string;
  dailyRateCents: number;
  transmission: string;
  seats: number;
  photoUrl: string;
}

function toPublicCar(c: Car): PublicCar {
  return {
    id: c.id,
    model: c.model,
    category: c.category,
    color: c.color,
    dailyRateCents: c.daily_rate,
    transmission: c.transmission,
    seats: c.seats,
    photoUrl: c.photo_url,
  };
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

const windowSchema = z
  .object({ pickupDate: dateSchema, returnDate: dateSchema })
  .refine((w) => w.returnDate > w.pickupDate, {
    message: "Return date must be after the pickup date",
    path: ["returnDate"],
  });

/**
 * Everything the wizard needs to render the calendar and the car step in one
 * round trip: the bookable fleet plus the occupied date ranges within the
 * booking horizon.
 *
 * The busy ranges carry only car_id + two dates — no guest names, no prices.
 * See findBusyRanges().
 */
export const getFleetAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const today = toKey(new Date());
  const horizon = toKey(new Date(Date.now() + CALENDAR_HORIZON_DAYS * DAY_MS));

  const [cars, busy] = await Promise.all([
    listBookableCars(),
    findBusyRanges(today, horizon),
  ]);

  return { cars: cars.map(toPublicCar), busy, today, horizon };
});

/**
 * Authoritative availability for a specific range — the Supabase replacement
 * for the old D1 `findAvailableCars`.
 *
 * The wizard already computes a split client-side from getFleetAvailability's
 * payload for instant feedback; this is the server's answer, called when the
 * guest reaches the car step so a stale cache cannot offer a car that was taken
 * thirty seconds ago.
 */
export const getAvailableCars = createServerFn({ method: "POST" })
  .inputValidator(windowSchema)
  .handler(async ({ data }) => {
    try {
      const cars = await findAvailableCars(data);
      return { ok: true as const, cars: cars.map(toPublicCar) };
    } catch (error) {
      if (error instanceof InvalidRentalWindowError) {
        return { ok: false as const, message: error.message, cars: [] };
      }
      throw error;
    }
  });

const submitSchema = windowSchema.and(
  z.object({
    carId: z.string().min(1),
    fullName: z.string().trim().min(1, "We need a name for the reservation."),
    email: z.string().trim().email("That email does not look complete."),
    phone: z.string().trim().min(7, "A phone or WhatsApp number helps us meet you."),
    pickupLocation: z.string().min(1),
    returnLocation: z.string().min(1),
    flightNumber: z.string().max(20).optional().nullable(),
    specialRequests: z.string().max(2000).optional().nullable(),
  }),
);

/**
 * Create a booking. NOTE what is absent from the input schema: there is no
 * price field. The total is computed server-side from the car's daily_rate, so
 * a crafted request cannot influence what the guest is charged.
 *
 * Returns a discriminated result rather than throwing on the expected failures
 * (car taken, car off the road) so the wizard can recover in place.
 */
export const submitBooking = createServerFn({ method: "POST" })
  .inputValidator(submitSchema)
  .handler(async ({ data }) => {
    try {
      return await createBooking(data);
    } catch (error) {
      if (error instanceof InvalidRentalWindowError) {
        return { ok: false as const, reason: "date_conflict" as const, message: error.message };
      }
      throw error;
    }
  });

/** Re-read a confirmation by id, so reloading the page does not lose it. */
export const fetchBookingConfirmation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bookingId: z.uuid() }))
  .handler(async ({ data }) => {
    const confirmation = await getBookingConfirmation(data.bookingId);
    return { confirmation };
  });
