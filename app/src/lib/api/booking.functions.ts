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
  createLicenseUploadTicket,
  findHandoverSlots,
  noPickupTimesLeftToday,
  findBusyRanges,
  getBookingConfirmation,
  listBookableCars,
  InvalidRentalWindowError,
} from "../booking/availability.server";
import {
  CALENDAR_HORIZON_DAYS,
  DAY_MS,
  DEFAULT_HANDOVER_TIME,
  RENTAL_TYPES,
  isHandoverTime,
  resolveWindow,
  toKey,
} from "../booking/rental";
import { LICENSE_PHOTO_PATH_RE, LICENSE_PHOTO_TYPES } from "../booking/license";
import type { Car } from "../supabase/types";

/** The car fields safe to serialise to the browser. `cars` is anon-readable in
 *  full, so this is shape discipline rather than a security boundary.
 *
 *  Both rates go out: the fleet cards and the wizard quote per-day and
 *  per-month side by side. Neither is trusted on the way back in — the server
 *  re-reads them at booking time. */
export interface PublicCar {
  id: string;
  model: string;
  category: string;
  color: string;
  dailyRateCents: number;
  /** 0 when this car is not offered monthly. */
  monthlyRateCents: number;
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
    monthlyRateCents: c.monthly_rate,
    transmission: c.transmission,
    seats: c.seats,
    photoUrl: c.photo_url,
  };
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** One of HANDOVER_TIMES. Defaults to the old fixed 10:00 so a browser still
 *  running the pre-time-picker bundle keeps working across a deploy. */
const timeSchema = z
  .string()
  .refine(isHandoverTime, "Pick a handover time from the list")
  .default(DEFAULT_HANDOVER_TIME);

/**
 * A rental as the browser describes it: a type, a start and the two handover
 * times, plus an end date that only a daily rental supplies.
 *
 * The end of a MONTHLY rental is never accepted from the client — resolveWindow
 * derives it, here and again inside createBooking. Accepting it would let a
 * request buy any length of stay for one month's money.
 */
const requestSchema = z
  .object({
    rentalType: z.enum(RENTAL_TYPES),
    pickupDate: dateSchema,
    returnDate: dateSchema.optional().nullable(),
    pickupTime: timeSchema,
    returnTime: timeSchema,
  })
  .refine((w) => w.rentalType === "monthly" || (w.returnDate && w.returnDate > w.pickupDate), {
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
 *
 * It answers for the DATES, and carries the handover times each car can still
 * be offered on them (findHandoverSlots). A car is listed only if at least one
 * pickup/return pair works, and the wizard's time pickers show only those
 * pairs. Any times in the request are ignored here: they are chosen from this
 * answer, not checked against it.
 */
export const getAvailableCars = createServerFn({ method: "POST" })
  .inputValidator(requestSchema)
  .handler(async ({ data }) => {
    const window = resolveWindow(data.rentalType, data.pickupDate, data.returnDate);
    try {
      const [fleet, slots] = await Promise.all([listBookableCars(), findHandoverSlots(window)]);
      const cars = fleet.filter((c) => slots[c.id]);
      return {
        ok: true as const,
        cars: cars.map(toPublicCar),
        slots,
        // Set when nothing is offered because today's last slot has passed,
        // so the wizard can say that instead of "every car is out".
        tooLateToday: noPickupTimesLeftToday(window.pickupDate),
        window,
      };
    } catch (error) {
      if (error instanceof InvalidRentalWindowError) {
        return { ok: false as const, message: error.message, cars: [], window };
      }
      throw error;
    }
  });

const submitSchema = requestSchema.and(
  z.object({
    carId: z.string().min(1),
    fullName: z.string().trim().min(1, "We need a name for the reservation."),
    email: z.string().trim().email("That email does not look complete."),
    phone: z.string().trim().min(7, "A phone or WhatsApp number helps us meet you."),
    pickupLocation: z.string().min(1),
    returnLocation: z.string().trim().min(1, "Tell us where to collect the car.").max(200),
    flightNumber: z.string().max(20).optional().nullable(),
    specialRequests: z.string().max(2000).optional().nullable(),
    license: z.object({
      number: z.string().trim().min(4, "That license number looks too short.").max(40),
      expiry: dateSchema,
      photoPath: z.string().regex(LICENSE_PHOTO_PATH_RE, "Please upload your license photo again."),
    }),
  }),
);

/**
 * A one-time upload slot for a driver's license photo. The browser then puts
 * the file straight into the private bucket with `uploadToSignedUrl`, and sends
 * back only the returned path with the booking. See createLicenseUploadTicket
 * for why the server, not the browser, picks the key.
 */
export const createLicenseUpload = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      contentType: z.enum(Object.keys(LICENSE_PHOTO_TYPES) as [string, ...string[]]),
    }),
  )
  .handler(async ({ data }) => createLicenseUploadTicket(data.contentType));

/**
 * Create a booking. NOTE what is absent from the input schema: there is no
 * price field, no day count and no discount. All three are computed server-side
 * from the car's rates and the dates the server resolved, so a crafted request
 * cannot influence what the guest is charged — not by naming a price, not by
 * claiming a discount tier, and not by stretching a monthly period.
 *
 * Returns a discriminated result rather than throwing on the expected failures
 * (car taken, car off the road, rental too short, rental long enough to need a
 * custom quote) so the wizard can recover in place.
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
