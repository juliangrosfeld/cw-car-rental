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
 * `await requireAdmin()`. The only handlers without it are the ones that exist
 * for someone who is NOT signed in yet: `adminSignIn` (validates a password),
 * `adminRequestPasswordReset` (reveals nothing), `adminCompletePasswordReset`
 * (authorised by the emailed recovery tokens) and the two invite functions
 * (authorised by a one-time invite token). None of them reads CRM data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getRequestUrl } from "@tanstack/react-start/server";

import { ADMIN_PASSWORD_MIN_LENGTH } from "../auth/password-policy";
import {
  completeAdminPasswordReset,
  readAdminSession,
  requestAdminPasswordReset,
  requireAdmin,
  signInAdmin,
  signOutAdmin,
  type AdminIdentity,
} from "../auth/admin.server";
import { acceptAdminInvite, isAdminInviteValid } from "../auth/invite.server";
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
import { getLicensePhotoLink, getLicensesList } from "../admin/licenses.server";
import { notifyBookingReturned } from "../email/notify-aftercare.server";
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
import { LOCATION_MAX_LENGTH } from "../../content/brand";
import { isCountry } from "../../content/countries";
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

/**
 * "Forgot password?": email a recovery link.
 *
 * Deliberately unauthenticated (that is the point of it) and deliberately
 * uninformative: the answer is `{ ok: true }` whether or not the address is an
 * admin's, so it cannot be used to find out which emails have accounts.
 */
export const adminRequestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z
        .string()
        .trim()
        .min(1, "Enter your email address.")
        .email("That is not an email address."),
    }),
  )
  .handler(async ({ data }) => {
    await requestAdminPasswordReset({ email: data.email, origin: getRequestUrl().origin });
    return { ok: true as const };
  });

/**
 * Set the new password from the emailed recovery link. The two tokens ARE the
 * authorisation: they only exist in a link Supabase mailed to the account's
 * own inbox. See completeAdminPasswordReset.
 */
export const adminCompletePasswordReset = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: z.string().min(20).max(4096),
      refreshToken: z.string().min(6).max(1024),
      // Never trimmed: a space is a legitimate password character.
      password: z
        .string()
        .min(ADMIN_PASSWORD_MIN_LENGTH, `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`)
        .max(200),
    }),
  )
  .handler(async ({ data }) => completeAdminPasswordReset(data));

/** The token in an invite link: 32 random bytes, base64url. */
const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Is this invite link still usable? Decides whether /admin/invite shows the
 *  form. Unauthenticated; the token is the authorisation. */
export const adminCheckInvite = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: inviteToken }))
  .handler(async ({ data }) => ({ valid: await isAdminInviteValid(data.token) }));

/**
 * Create an admin login from a one-time invite link. The token IS the
 * authorisation: it only exists in a link minted with the service role key and
 * handed over privately. See src/lib/auth/invite.server.ts.
 */
export const adminAcceptInvite = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: inviteToken,
      email: z
        .string()
        .trim()
        .min(1, "Enter your email address.")
        .max(254)
        .email("That is not an email address."),
      // Never trimmed: a space is a legitimate password character.
      password: z
        .string()
        .min(ADMIN_PASSWORD_MIN_LENGTH, `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`)
        .max(200),
    }),
  )
  .handler(async ({ data }) => acceptAdminInvite(data));

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
    const result = await setBookingPrepStatus(data);

    // A booking that has just BECOME returned gets its thank-you email. Only on
    // a real transition (ok, and it was not already returned), and only after
    // the write above has succeeded. notifyBookingReturned never throws, is
    // bounded by a 6 second timeout, and refuses to send twice, so nothing it
    // does can undo or hold up the return. It is awaited rather than fired and
    // forgotten because Vercel may freeze the function the moment it responds.
    if (result.ok && data.to === "returned" && data.expectedFrom !== "returned") {
      await notifyBookingReturned(data.bookingId);
    }
    return result;
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

/* ── license photos ────────────────────────────────────────────────────────── */

/**
 * A signed link (about 60 seconds) to one client's license photo.
 *
 * ADMIN ONLY, CHECKED HERE: requireAdmin() resolves the session cookie against
 * Supabase Auth and requires app_metadata.role === 'admin' before anything is
 * signed. The bucket itself stays private; this is the only door.
 *
 * POST, not GET, although it only reads: a GET could be cached or prefetched,
 * and a cached one-minute link is a broken image.
 */
export const fetchLicensePhoto = createServerFn({ method: "POST" })
  .inputValidator(z.object({ clientId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return getLicensePhotoLink(data.clientId);
  });

/** The Licenses page: every client with a license on file, searchable by name. */
export const fetchAdminLicenses = createServerFn({ method: "GET" })
  .inputValidator(z.object({ query: z.string().max(120).nullish() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return { admin, list: await getLicensesList(data.query ?? "") };
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
 * By default the price is the price list's, recomputed here from the database,
 * exactly as on the public endpoint. The one difference: an admin may send
 * `priceOverride` to set their own total. It is honoured only because
 * requireAdmin() has passed; the standard quote is still computed and stored
 * beside it. There is still no day count and no rate in the input.
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
          // Optional at the counter: a booking taken on a bad phone line should
          // not be blocked on it. When given, it is one of COUNTRIES.
          country: z.string().refine(isCountry, "Pick the country from the list.").nullish(),
        })
        .nullish(),
      vehicleId: z.uuid(),
      rentalType: z.enum(RENTAL_TYPES),
      pickupDate: dateKeySchema,
      returnDate: dateKeySchema.nullish(),
      pickupLocation: z
        .string()
        .trim()
        .min(1, "Where are they collecting?")
        .max(LOCATION_MAX_LENGTH, `Keep the pickup address under ${LOCATION_MAX_LENGTH} characters.`),
      returnLocation: z
        .string()
        .trim()
        .min(1, "Where are they returning it?")
        .max(LOCATION_MAX_LENGTH, `Keep the return address under ${LOCATION_MAX_LENGTH} characters.`),
      flightNumber: z.string().trim().max(20).nullish(),
      specialRequests: z.string().max(2000).nullish(),
      adminNotes: z.string().max(5000).nullish(),
      // A booking taken over the phone is normally already agreed, so the form
      // defaults to confirmed — but 'pending' stays available for a hold that is
      // not yet firm. Nothing further along the pipeline can be set from here:
      // 'active' and 'completed' are things that happen, not things you declare.
      bookingStatus: z.enum(["pending", "confirmed"]).default("confirmed"),
      paymentStatus: z.enum(PAYMENT_STATUS).default("unpaid"),
      // "Set own price". Absent or null means the price list applies, exactly
      // as before. This field exists ONLY on this admin endpoint: the public
      // submitBooking schema has no price of any kind, so a guest's request
      // cannot reach it.
      priceOverride: z
        .object({
          totalCents: z
            .number()
            .int("Enter the price in whole cents.")
            .positive("A custom price must be more than zero.")
            // XCG 1,000,000. A typo guard, not a business rule.
            .max(100_000_000, "That price is too large to be right."),
          note: z.string().trim().max(500, "Keep the note under 500 characters.").nullish(),
        })
        .nullish(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    return createManualBooking({
      clientId: data.clientId ?? null,
      guest: data.guest ? { ...data.guest, country: data.guest.country ?? null } : null,
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
      priceOverride: data.priceOverride
        ? { totalCents: data.priceOverride.totalCents, note: data.priceOverride.note?.trim() || null }
        : null,
      handledBy: admin.email,
    });
  });
