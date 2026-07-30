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
  getBookingDetail,
  getBookingsBoard,
  getBookingsList,
  setBookingAdminNotes,
  setBookingPrepStatus,
} from "../admin/bookings.server";
import { getFleetCar, getFleetOverview, updateCar } from "../admin/fleet.server";
import { STATS_WINDOWS, type StatsWindow } from "../admin/fleet";
import { PREP_FLOW } from "../admin/prep";
import { CAR_STATUS } from "../supabase/types";
import type { BookingFilters } from "../admin/types";

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
 * Edit a car: rate, standing availability, photo, maintenance notes.
 *
 * The rate arrives in CENTS — the form converts from the dollars an owner types,
 * and every money value in this app is an integer of cents by the time it
 * crosses a boundary. Returns a discriminated result so a bad rate renders in
 * the form instead of throwing, and so the page can report how many existing
 * rentals a car that just left the road still has.
 */
export const updateFleetCar = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      carId: z.string().min(1).max(64),
      dailyRateCents: z.number().int().min(0),
      status: z.enum(CAR_STATUS),
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
      maintenanceNotes: z.string().max(5000, "Notes are limited to 5000 characters."),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    return updateCar(data);
  });
