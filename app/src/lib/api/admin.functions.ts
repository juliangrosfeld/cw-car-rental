/**
 * Admin server functions — the CRM's entire interface to the database.
 *
 * SECURITY MODEL, IN ONE PLACE
 * Every function here is a public HTTP endpoint. The `/admin/*` route guard runs
 * in the router, i.e. in the browser, so it stops an honest visitor and nobody
 * else. What actually protects the data is the `requireAdmin()` call at the top
 * of each handler below, which reads the httpOnly session cookie, resolves it
 * against Supabase Auth, and throws a redirect if the caller is not an admin.
 *
 * If you add a function to this file, the first line of its handler is
 * `await requireAdmin()`. There is no exception; `adminSignIn` is not one
 * either, it is simply the endpoint that establishes the session in the first
 * place and it validates a password instead.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  readAdminSession,
  requireAdmin,
  signInAdmin,
  signOutAdmin,
  type AdminIdentity,
} from "../auth/admin.server";
import { getDashboardData } from "../admin/dashboard.server";
import {
  createManualBooking,
  getBookingDetail,
  getBookingsBoard,
  getBookingsList,
  getManualBookingOptions,
  setBookingAdminNotes,
  setBookingPrepStatus,
} from "../admin/bookings.server";
import { getClientDetail, getClientsList } from "../admin/clients.server";
import { getFleetCar, getFleetOverview, updateCar, updateVehicle } from "../admin/fleet.server";
import {
  getBookingLedger,
  getPaymentsOverview,
  recordPayment,
  syncBookingPaymentStatus,
} from "../admin/payments.server";
import { PAYMENT_METHODS } from "../admin/payments";
import { STATS_WINDOWS, type StatsWindow } from "../admin/fleet";
import { PREP_FLOW } from "../admin/prep";
import { RENTAL_TYPES } from "../booking/rental";
import { PAYMENT_STATUS, VEHICLE_STATUS } from "../supabase/types";
import type { BookingFilters, ClientFilter, PaymentsFilter } from "../admin/types";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("That is not an email address."),
  // No max, no complexity rule: this checks what was typed, and the real
  // password policy lives in Supabase Auth where it can be changed without a
  // deploy. Never trim a password — a trailing space is a legitimate character.
  password: z.string().min(1, "Enter your password."),
});

/**
 * Sign in. Returns a discriminated result instead of throwing so the form can
 * render the failure in place; the message is deliberately the same for a wrong
 * password and an unknown address.
 */
export const adminSignIn = createServerFn({ method: "POST" })
  .inputValidator(credentialsSchema)
  .handler(async ({ data }) => signInAdmin(data));

/** Sign out. Always succeeds from the caller's point of view — the cookies are
 *  cleared before the token revocation is even attempted. */
export const adminSignOut = createServerFn({ method: "POST" }).handler(async () => {
  await signOutAdmin();
  return { ok: true as const };
});

/**
 * Who is signed in, or null. Used by the login page to bounce an already
 * signed-in admin straight to the dashboard, so it must NOT use requireAdmin —
 * "nobody is signed in" is a normal answer here, not a redirect.
 */
export const fetchAdminSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ admin: AdminIdentity | null }> => ({ admin: await readAdminSession() }),
);

/** The dashboard's single round trip. */
export const fetchAdminDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const admin = await requireAdmin();
  return { admin, data: await getDashboardData() };
});

/* ── bookings ──────────────────────────────────────────────────────────────── */

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** 'YYYY-MM'. Every value here arrives from the URL, so it is validated rather
 *  than trusted; an absent or malformed month falls back to the current one
 *  inside getBookingsBoard, because a bad query string should show the calendar
 *  rather than an error page. */
const monthSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a YYYY-MM month")
    .nullish(),
});

const filtersSchema = z.object({
  // An empty array means "every status" — the absence of a filter, not a filter
  // that matches nothing. getBookingsList skips the `in` clause for it.
  prep: z.array(z.enum(PREP_FLOW)).default([]),
  carId: z.string().min(1).nullish(),
  from: dateKeySchema.nullish(),
  to: dateKeySchema.nullish(),
});

const prepWriteSchema = z.object({
  bookingId: z.uuid(),
  to: z.enum(PREP_FLOW),
  /** The status the admin was looking at. Turns a double-submit or a second open
   *  tab into a typed `stale` result instead of a silent overwrite — see
   *  setBookingPrepStatus. */
  expectedFrom: z.enum(PREP_FLOW),
});

const notesWriteSchema = z.object({
  bookingId: z.uuid(),
  // Bounded so a paste accident cannot write a megabyte into a text column.
  // Whitespace-only collapses to NULL in the writer, not here.
  notes: z.string().max(5000, "Notes are limited to 5000 characters."),
});

/** The month timeline: one row per car, bars clipped to the month. */
export const fetchAdminBookingsBoard = createServerFn({ method: "GET" })
  .inputValidator(monthSchema)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, board: await getBookingsBoard(data.month) };
  });

/** The filtered list — the same bookings as the timeline, as a queue. */
export const fetchAdminBookingsList = createServerFn({ method: "GET" })
  .inputValidator(filtersSchema)
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const filters: BookingFilters = {
      prep: data.prep,
      carId: data.carId ?? null,
      from: data.from ?? null,
      to: data.to ?? null,
    };
    return { admin, list: await getBookingsList(filters) };
  });

/**
 * One booking in full. `booking: null` is a normal answer for a stale link.
 *
 * The id is NOT validated as a uuid here, unlike the writes below: it arrives
 * from the address bar, and a mistyped link should render the "not found" page
 * rather than a 500 from a rejected input. getBookingDetail does the shape check
 * and returns null. The length bound is just to keep a junk URL from becoming a
 * junk query.
 */
export const fetchAdminBooking = createServerFn({ method: "GET" })
  .inputValidator(z.object({ bookingId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, booking: await getBookingDetail(data.bookingId) };
  });

/**
 * Move a booking along the prep pipeline. Returns a discriminated result rather
 * than throwing, so the page can redraw from the row that actually exists when
 * two tabs disagree.
 */
export const updateBookingPrepStatus = createServerFn({ method: "POST" })
  .inputValidator(prepWriteSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    return setBookingPrepStatus(data);
  });

/** Save the internal notes. `updated_at` is stamped by the database trigger. */
export const updateBookingAdminNotes = createServerFn({ method: "POST" })
  .inputValidator(notesWriteSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    return setBookingAdminNotes(data);
  });

/* ── clients ───────────────────────────────────────────────────────────────── */

/**
 * The client directory. Search and filter are applied server-side inside
 * getClientsList — see the note there on why matching happens in TypeScript
 * rather than in `ilike`.
 */
export const fetchAdminClients = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      // Bounded so a pasted essay cannot become a query. Trimming and matching
      // are the aggregate's job.
      query: z.string().max(120).nullish(),
      filter: z.enum(["all", "repeat", "licence", "duplicates"]).nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return {
      admin,
      list: await getClientsList({
        query: data.query ?? "",
        filter: (data.filter ?? "all") as ClientFilter,
      }),
    };
  });

/**
 * One client in full: profile, every booking they have, lifetime value, and any
 * other records that look like the same person. `client: null` for a stale link.
 */
export const fetchAdminClient = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, client: await getClientDetail(data.clientId) };
  });

/* ── payments ──────────────────────────────────────────────────────────────── */

/** The money screen: what has been taken, what is owed, and the ledger. */
export const fetchAdminPayments = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      filter: z.enum(["outstanding", "paid", "refunded", "mismatched", "all"]).nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return {
      admin,
      payments: await getPaymentsOverview((data.filter ?? "outstanding") as PaymentsFilter),
    };
  });

/** One booking's ledger, for the payments panel on its page. */
export const fetchBookingLedger = createServerFn({ method: "GET" })
  .inputValidator(z.object({ bookingId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return { ledger: await getBookingLedger(data.bookingId) };
  });

/**
 * Record money that has already changed hands — cash at the counter, a card
 * machine, a transfer that landed.
 *
 * THE AMOUNT ARRIVES IN CENTS and the SIGN is not in it: `direction` says
 * whether this is a charge or a refund, so no form can turn a mistyped minus
 * into a refund. Nothing here contacts a payment provider; see PROVIDER in
 * src/lib/admin/payments.ts.
 */
export const recordBookingPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      bookingId: z.uuid(),
      amountCents: z.number().int().positive(),
      method: z.enum(PAYMENT_METHODS),
      direction: z.enum(["charge", "refund"]),
      pending: z.boolean().nullish(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    return recordPayment({ ...data, pending: data.pending ?? false });
  });

/** Make a booking's stored payment status agree with its ledger. The repair for
 *  a mismatch, applied deliberately rather than silently at read time. */
export const syncBookingPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bookingId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return { ok: true as const, ledger: await syncBookingPaymentStatus(data.bookingId) };
  });

/* ── fleet ─────────────────────────────────────────────────────────────────── */

const statsWindowSchema = z
  .number()
  .int()
  .refine((n): n is StatsWindow => (STATS_WINDOWS as readonly number[]).includes(n), {
    message: "Unsupported stats window",
  })
  .nullish();

/** The fleet overview: five cars, their standing availability, and what each has
 *  earned over the chosen window. */
export const fetchAdminFleet = createServerFn({ method: "GET" })
  .inputValidator(z.object({ windowDays: statsWindowSchema }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, fleet: await getFleetOverview(data.windowDays) };
  });

/** One car: its details, its numbers, and its own month calendar. */
export const fetchAdminFleetCar = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      // Car ids are FLEET slugs, not uuids, and this one comes from the address
      // bar: an unknown slug is a miss, which getFleetCar answers with null.
      carId: z.string().min(1).max(64),
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a YYYY-MM month")
        .nullish(),
      windowDays: statsWindowSchema,
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, car: await getFleetCar(data.carId, data.month, data.windowDays) };
  });

/**
 * Edit a LISTING: rates, photo, guest-facing copy.
 *
 * Both rates arrive in CENTS — the form converts from the guilders an owner
 * types, and every money value in this app is an integer of cents by the time it
 * crosses a boundary. Returns a discriminated result so a bad rate renders in
 * the form instead of throwing.
 *
 * Standing availability is NOT here any more. It belongs to a physical car, and
 * a listing backed by two of them has two answers — see updateFleetVehicle.
 */
export const updateFleetCar = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      carId: z.string().min(1).max(64),
      dailyRateCents: z.number().int().min(0),
      // 0 is meaningful, not missing: it takes the listing off the monthly
      // product while leaving its daily availability alone.
      monthlyRateCents: z.number().int().min(0),
      // Either a path served by this app or an absolute https URL. Kept narrow
      // deliberately: this string is rendered as an <img src> on the public site,
      // so `javascript:` and friends must never reach it.
      photoUrl: z
        .string()
        .trim()
        .min(1, "A car needs a photo.")
        .max(500)
        .refine((v) => v.startsWith("/") || v.startsWith("https://"), {
          message: "Use a path like /assets/fleet/… or a full https:// URL.",
        }),
      description: z.string().max(2000, "The description is limited to 2000 characters."),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    return updateCar(data);
  });

/**
 * Edit a VEHICLE: its condition, its plate, its colour.
 *
 * This is the endpoint that can take a car off the road, which is why its result
 * carries both how many rentals are still booked on it AND whether its listing
 * survived — with a second car behind it, nothing a guest can see has changed.
 */
export const updateFleetVehicle = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      vehicleId: z.uuid(),
      status: z.enum(VEHICLE_STATUS),
      // Bounded and free-form: Curaçao plates do not fit one pattern worth
      // enforcing here, and a rejected legitimate plate is worse than a typo an
      // owner can see and fix. Empty means "not on file".
      plateNumber: z.string().trim().max(20, "A plate is at most 20 characters."),
      color: z.string().trim().min(1, "A car needs a colour.").max(40),
      maintenanceNotes: z.string().max(5000, "Notes are limited to 5000 characters."),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    return updateVehicle(data);
  });

/* ── manual bookings ───────────────────────────────────────────────────────── */

/**
 * Everything the manual booking screen needs: the fleet down to the individual
 * car, the guest directory, and — once dates are supplied — which cars are
 * actually free over them.
 *
 * The dates are optional and nullable on purpose: the form loads before anyone
 * has typed one, and "not asked yet" must not render as "nothing is free".
 */
export const fetchManualBookingOptions = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      pickupDate: dateKeySchema.nullish(),
      returnDate: dateKeySchema.nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return {
      admin,
      options: await getManualBookingOptions({
        pickupDate: data.pickupDate ?? null,
        returnDate: data.returnDate ?? null,
      }),
    };
  });

/**
 * Take a booking by hand, against a NAMED physical car.
 *
 * NOTE what is absent, exactly as on the public endpoint: no price, no day
 * count, no discount. An operator at the counter is subject to the same price
 * list as the website — see createManualBooking for why that is deliberate and
 * what to do when a deal genuinely differs.
 *
 * `handledBy` is not accepted from the form either. It is the signed-in admin,
 * taken from the session below, so the record of who took a booking cannot be
 * typed by whoever is filling it in.
 */
export const createBookingManually = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      clientId: z.uuid().nullish(),
      guest: z
        .object({
          fullName: z.string().trim().min(1, "We need a name for the reservation."),
          email: z.string().trim().email("That email does not look complete."),
          phone: z.string().trim().min(5, "A phone or WhatsApp number helps us meet them."),
        })
        .nullish(),
      vehicleId: z.uuid(),
      rentalType: z.enum(RENTAL_TYPES),
      pickupDate: dateKeySchema,
      returnDate: dateKeySchema.nullish(),
      pickupLocation: z.string().trim().min(1, "Where are they collecting?").max(200),
      returnLocation: z.string().trim().min(1, "Where are they returning it?").max(200),
      flightNumber: z.string().trim().max(20).nullish(),
      specialRequests: z.string().max(2000).nullish(),
      adminNotes: z.string().max(5000).nullish(),
      // A booking taken over the phone is normally already agreed, so the form
      // defaults to confirmed — but 'pending' stays available for a hold that is
      // not yet firm. Nothing further along the pipeline can be set from here:
      // 'active' and 'completed' are things that happen, not things you declare.
      bookingStatus: z.enum(["pending", "confirmed"]).default("confirmed"),
      paymentStatus: z.enum(PAYMENT_STATUS).default("unpaid"),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return createManualBooking({
      clientId: data.clientId ?? null,
      guest: data.guest ?? null,
      vehicleId: data.vehicleId,
      rentalType: data.rentalType,
      pickupDate: data.pickupDate,
      returnDate: data.returnDate ?? null,
      pickupLocation: data.pickupLocation,
      returnLocation: data.returnLocation,
      flightNumber: data.flightNumber ?? null,
      specialRequests: data.specialRequests ?? null,
      adminNotes: data.adminNotes ?? null,
      bookingStatus: data.bookingStatus,
      paymentStatus: data.paymentStatus,
      handledBy: admin.email,
    });
  });
