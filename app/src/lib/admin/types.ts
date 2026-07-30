/**
 * The shapes the CRM sends to the browser. No imports, no I/O — this file is the
 * contract between `*.server.ts` aggregates and the admin components, so the UI
 * can type against it without pulling a server module into the client bundle.
 *
 * MONEY is always integer cents, matching the database. Format only at the edge,
 * with formatMoney() in ./format.
 *
 * Nothing here may carry a field the admin is not allowed to see — but note the
 * inverse of the public booking payload: these rows DO include guest names and
 * `admin_notes`-adjacent context, because every route that returns them has
 * already run requireAdmin().
 */

import type { BookingStatus, CarStatus, PaymentStatus, PrepStatus } from "../supabase/types";

/**
 * The signed-in admin, as the UI sees them. Lives here rather than beside the
 * session logic in `src/lib/auth/admin.server.ts` so that admin components can
 * type against it without importing a `.server.ts` module at all — `import type`
 * would be erased, but a stray value import from the same file would drag the
 * service-role client into the browser bundle, and this removes the temptation.
 */
export interface AdminIdentity {
  id: string;
  email: string;
  /** Always 'admin' — the value is what got this identity past the check. */
  role: "admin";
  /** ISO instant, or null for an account that has never signed in. */
  lastSignInAt: string | null;
}

/** One booking, flattened for a table row. */
export interface BookingRow {
  id: string;
  /** First 8 characters of the uuid — what an admin reads out on the phone. */
  ref: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  carId: string;
  carLabel: string;
  /** 'YYYY-MM-DD' */
  pickupDate: string;
  /** 'HH:MM:SS' */
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  pickupLocation: string;
  returnLocation: string;
  days: number;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
  /** ISO instant. */
  createdAt: string;
}

/* ── bookings: the month timeline ──────────────────────────────────────────── */

/**
 * One booking drawn as a bar in one car's row.
 *
 * `startCol` / `span` are 1-based grid columns within the month being shown, and
 * are already clipped to it — see src/lib/admin/timeline.ts for the half-open
 * column model that decides the width (short version: width in columns equals
 * billable days, and back-to-back rentals tile without overlapping).
 */
export interface TimelineBar {
  bookingId: string;
  ref: string;
  clientName: string;
  carId: string;
  /** 'YYYY-MM-DD' — the real dates, unclipped, for the label and tooltip. */
  pickupDate: string;
  returnDate: string;
  pickupTime: string;
  returnTime: string;
  /** Billable days for the whole rental, not just the part shown this month. */
  days: number;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
  startCol: number;
  span: number;
  /** Runs in from before the month / out past the end of it. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Vertical lane within the car's row. 0 unless bars genuinely overlap. */
  lane: number;
}

/** One car's row on the timeline. */
export interface TimelineRow {
  carId: string;
  carLabel: string;
  carStatus: CarStatus;
  /** How many lanes this row needs — 1 on a normal month. */
  lanes: number;
  bars: TimelineBar[];
}

export interface BookingsBoardData {
  /** 'YYYY-MM' being shown. */
  month: string;
  monthLabel: string;
  /** One entry per column, 'YYYY-MM-DD'. */
  days: string[];
  prevMonth: string;
  nextMonth: string;
  /** Today in Curaçao — the column to highlight, if it is in this month. */
  today: string;
  /** Current month key, so the UI can offer "back to this month". */
  currentMonth: string;
  rows: TimelineRow[];
  /** Bookings touching this month, and how they split across the pipeline. */
  visibleCount: number;
  prepCounts: Record<PrepStatus, number>;
}

/* ── bookings: the list ────────────────────────────────────────────────────── */

/** The filters the list view supports, exactly as they appear in the URL. */
export interface BookingFilters {
  /** Empty means every prep status. */
  prep: PrepStatus[];
  /** A car id, or null for the whole fleet. */
  carId: string | null;
  /** Inclusive 'YYYY-MM-DD' bounds on the RENTAL WINDOW, not on the pickup
   *  date: a rental that starts before `from` but is still running inside the
   *  range matches, which is what "show me August" means at a counter and what
   *  keeps this view consistent with the calendar. Either end may be null. */
  from: string | null;
  to: string | null;
}

export interface BookingsListData {
  filters: BookingFilters;
  rows: BookingRow[];
  /** Exact number of matches, which may exceed rows.length. */
  total: number;
  /** True when `total` was capped by the fetch limit. */
  truncated: boolean;
  /** Pipeline counts across ALL bookings, ignoring the filters — the queue
   *  numbers on the filter chips have to keep standing still while you filter. */
  prepCounts: Record<PrepStatus, number>;
  /** The fleet, for the car filter. Ordered by rate, like everywhere else. */
  cars: { id: string; label: string }[];
}

/* ── bookings: one booking, in full ────────────────────────────────────────── */

/**
 * Everything the detail view shows. This is the widest payload in the CRM — it
 * carries the guest's licence details and `adminNotes`, which is INTERNAL ONLY
 * and must never reach a guest-facing route. The only thing that makes it safe
 * to serialise is that the server function returning it called requireAdmin().
 */
export interface BookingDetail {
  id: string;
  ref: string;
  client: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    licenseNumber: string | null;
    licenseExpiry: string | null;
    dateOfBirth: string | null;
    countryOfResidence: string | null;
  };
  car: {
    id: string;
    label: string;
    model: string;
    color: string;
    category: string;
    transmission: string;
    seats: number;
    status: CarStatus;
    /** The car's rate TODAY, which is not necessarily what this rental was
     *  quoted at — see `quotedPerDayCents`. */
    dailyRateCents: number;
  };
  pickupDate: string;
  pickupTime: string;
  pickupLocation: string;
  returnDate: string;
  returnTime: string;
  returnLocation: string;
  flightNumber: string | null;
  days: number;
  /** total / days, i.e. what this booking was actually charged per day. Compare
   *  with car.dailyRateCents to spot a rate change since it was taken. */
  quotedPerDayCents: number;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
  /** Customer-facing. Safe to read back to the guest on the phone. */
  specialRequests: string | null;
  /** INTERNAL ONLY. Never echo this to a guest. */
  adminNotes: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The result of a write from the CRM.
 *
 * `stale` is not an error the admin caused: it means the row moved under them
 * (another tab, another admin, a status set from the list while the detail page
 * was open), so the button they pressed was computed from a view that no longer
 * holds. The fresh booking comes back with it so the UI can redraw rather than
 * guess.
 */
export type BookingWriteResult =
  | { ok: true; booking: BookingDetail }
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "stale"; message: string; booking: BookingDetail };

/* ── fleet ─────────────────────────────────────────────────────────────────── */

/**
 * What a car did over a stated window. Every field is scoped to that window and
 * the window is always shown beside them, because "utilisation" with no period
 * attached is not a number anyone can act on.
 */
export interface FleetCarStats {
  /** Length of the window in days, ending today inclusive. */
  windowDays: number;
  /** Days inside the window the car was spoken for — paid or not, since an
   *  unpaid rental still kept it off the forecourt. */
  daysOut: number;
  /** daysOut / windowDays as 0-100, one decimal. */
  utilisationPct: number;
  /**
   * Money COLLECTED: paid bookings, recognised on the pickup date. The same
   * basis the dashboard uses, deliberately — two pages of one tool must not
   * answer "what did this car earn" differently.
   */
  collectedCents: number;
  /** Rentals whose pickup fell in the window, paid or not. */
  rentals: number;
  /** Mean billable days per rental in the window, one decimal. */
  averageRentalDays: number;
}

/** One car on the fleet overview. */
export interface FleetCarRow {
  id: string;
  label: string;
  model: string;
  color: string;
  category: string;
  photoUrl: string;
  dailyRateCents: number;
  status: CarStatus;
  /** INTERNAL — never goes near a public payload. */
  maintenanceNotes: string | null;
  offRoadSince: string | null;
  /** Whole days since it left the road, or null while it is on it. */
  offRoadDays: number | null;
  stats: FleetCarStats;
  /** Set while the car is out on a rental at this moment. */
  onRentalUntil: string | null;
  onRentalFor: string | null;
  /** Rentals still ahead of it, and the first of them. */
  upcomingCount: number;
  nextPickupDate: string | null;
  nextPickupFor: string | null;
}

export interface FleetOverview {
  today: string;
  windowDays: number;
  /** 'YYYY-MM-DD' bounds of the stats window, both inclusive for display. */
  windowStart: string;
  windowEnd: string;
  cars: FleetCarRow[];
  totals: {
    cars: number;
    offRoad: number;
    outNow: number;
    collectedCents: number;
    utilisationPct: number;
  };
}

/** A rental in a car's own schedule. */
export interface CarRental {
  bookingId: string;
  clientName: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  days: number;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
}

/** One car in full: what it is, what it earns, and who has it when. */
export interface FleetCarDetail {
  id: string;
  label: string;
  model: string;
  color: string;
  category: string;
  transmission: string;
  seats: number;
  photoUrl: string;
  dailyRateCents: number;
  status: CarStatus;
  maintenanceNotes: string | null;
  offRoadSince: string | null;
  offRoadDays: number | null;
  updatedAt: string;
  today: string;
  stats: FleetCarStats;

  /** The month strip: same shape and same rules as the bookings calendar. */
  month: string;
  monthLabel: string;
  days: string[];
  prevMonth: string;
  nextMonth: string;
  currentMonth: string;
  timeline: TimelineRow;

  /** Out on the road right now, if it is. */
  onRental: {
    bookingId: string;
    clientName: string;
    returnDate: string;
    returnTime: string;
  } | null;
  upcoming: CarRental[];
}

/**
 * The result of a fleet write.
 *
 * `wentOffRoad` + `affectedRentals` exist so the page can tell the truth after
 * the fact: the status change is applied, existing rentals are untouched, and
 * here is how many of them there are to deal with by hand.
 */
export type CarWriteResult =
  | { ok: true; carId: string; wentOffRoad: boolean; affectedRentals: number }
  | { ok: false; reason: "not_found" | "invalid"; message: string };

/** A pickup or a return on the schedule — the two halves of "what happens next". */
export interface MovementRow {
  bookingId: string;
  ref: string;
  kind: "pickup" | "return";
  /** Wall-clock 'YYYY-MM-DDTHH:MM:SS', already sorted on by the server. */
  at: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  carLabel: string;
  location: string;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  /** Whole days from now — negative means it is overdue. */
  daysAway: number;
}

/** One car and what it is doing right now. */
export interface FleetStatusRow {
  id: string;
  label: string;
  status: CarStatus;
  dailyRateCents: number;
  /** Set when the car is out on a rental at this moment. */
  onRentalUntil: string | null;
  onRentalFor: string | null;
}

export interface RevenuePoint {
  /** 'YYYY-MM-DD' */
  date: string;
  cents: number;
}

export interface DashboardData {
  /** Curaçao wall clock the figures were computed against. */
  asOf: string;
  today: string;
  monthLabel: string;

  /**
   * MONEY EARNED — recognised on the PICKUP date, paid bookings only.
   *
   * This is cash over the counter: a rental booked in March for a July pickup
   * belongs to July here, and contributes nothing until the keys change hands.
   * Its counterpart is `booked` below, and the two answer genuinely different
   * questions — see the note there before treating either as "the" revenue.
   */
  revenue: {
    todayCents: number;
    monthCents: number;
    /** How many paid rentals made up monthCents. */
    monthCount: number;
    ytdCents: number;
    allTimeCents: number;
    /** Booked but not yet paid — money still to collect. */
    outstandingCents: number;
    /** The previous calendar month, for the month-over-month delta. */
    previousMonthCents: number;
    /** Last 14 days by pickup date, oldest first. Always 14 entries, zeros included. */
    daily: RevenuePoint[];
  };

  /**
   * SALES ACTIVITY — recognised on the date the booking was TAKEN, whatever it
   * is worth and whenever the car actually goes out. Paid and unpaid alike.
   *
   * WHY BOTH EXIST, AND WHY NEITHER IS WRONG
   * A quiet July for `revenue` with a strong July for `booked` means the phone
   * is ringing and the money lands in September; the reverse means a good month
   * is being collected on work done earlier. Reporting only the first makes a
   * marketing push look like a failure for two months; reporting only the second
   * counts money that has not arrived and might yet cancel. They deliberately do
   * not reconcile to each other in any given month, which is exactly why the UI
   * labels them by their date basis rather than calling either one "revenue".
   *
   * Cancelled bookings are excluded, matching every other figure here: a
   * reservation that evaporated is not sales activity that happened.
   */
  booked: {
    monthCents: number;
    /** Number of bookings taken this month. */
    monthCount: number;
    /** The previous calendar month, for the month-over-month delta. */
    previousMonthCents: number;
    /** Last 14 days by booking date, oldest first. Always 14 entries. */
    daily: RevenuePoint[];
  };

  week: {
    /** Monday and Sunday of the current Curaçao week, 'YYYY-MM-DD'. */
    start: string;
    end: string;
    /** Bookings CREATED this week — new business, not rentals in progress. */
    count: number;
    valueCents: number;
    bookings: BookingRow[];
  };

  /** Next pickups and returns, merged and sorted by when they happen. */
  upcoming: MovementRow[];

  fleet: {
    total: number;
    /** Cars on a rental at this instant. */
    outNow: number;
    /** On the road and free right now. */
    availableNow: number;
    /** status is 'maintenance' or 'offline'. */
    offRoad: number;
    /** outNow / total, 0-100, rounded to one decimal. */
    occupancyPct: number;
    cars: FleetStatusRow[];
  };
}
