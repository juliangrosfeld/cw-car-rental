/**
 * Client database — reads for /admin/clients. Service role, RLS bypassed:
 * import ONLY from server functions that have already called requireAdmin().
 *
 * READ-ONLY, DELIBERATELY. This phase surfaces what is on file; it does not edit
 * it and it does not merge duplicate records. Both are real needs and both are
 * destructive in ways that want their own design — a merge rewrites bookings'
 * client_id and deletes a person's record, and an edit form over a row that the
 * booking path also writes needs a conflict story. Shipping a read that tells
 * the truth is worth more than a write that quietly picks a winner.
 *
 * WHY EVERYTHING IS AGGREGATED IN JS
 * PostgREST has no GROUP BY, and every figure here is per-client over their
 * whole history: rental counts, lifetime value, first and last pickup. The
 * honest options are a Postgres view, an RPC, or fetching the rows and counting
 * them here. At CW's scale — hundreds of guests, a few thousand bookings — the
 * fetch is a few hundred kilobytes and the counting is microseconds, and it
 * keeps the definitions in TypeScript beside the tests and the UI that reads
 * them. The moment this stops being cheap the fix is a view or an RPC keyed on
 * client_id, NOT pagination over a half-computed aggregate.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import { rentalDays } from "../booking/rental";
import type { BookingStatus, PaymentStatus, PrepStatus } from "../supabase/types";
import { curacaoNow } from "./clock";
import {
  countsAsRental,
  duplicateReason,
  isRepeatCustomer,
  licenceLevel,
  matchesQuery,
  needsLicenceAttention,
  normaliseEmail,
  normaliseName,
  normalisePhone,
} from "./clients";
import type {
  ClientBooking,
  ClientDetail,
  ClientFilter,
  ClientRow,
  ClientValue,
  ClientsListData,
  DuplicateCandidate,
} from "./types";

/** How many client rows the list will pull before it stops being honest about
 *  totals. See the note in the header: this is the point at which the aggregate
 *  moves into Postgres, not the point at which we start paginating. */
const CLIENT_FETCH_LIMIT = 2000;

/** How many rows the table renders. The count above it is the full match. */
const DISPLAY_LIMIT = 200;

const CLIENT_SELECT = `
  id, full_name, email, phone, license_number, license_expiry,
  date_of_birth, country_of_residence, created_at, updated_at
`;

/** Bookings carry the money and the dates; the car join gives the label. */
const BOOKING_SELECT = `
  id, client_id, car_id, pickup_date, pickup_time, return_date, return_time,
  total_price, booking_status, payment_status, prep_status, created_at,
  cars ( model, color )
`;

interface RawClient {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  license_number: string | null;
  license_expiry: string | null;
  date_of_birth: string | null;
  country_of_residence: string | null;
  created_at: string;
  updated_at: string;
}

interface RawBooking {
  id: string;
  client_id: string;
  car_id: string;
  pickup_date: string;
  pickup_time: string;
  return_date: string;
  return_time: string;
  total_price: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  prep_status: PrepStatus;
  created_at: string;
  cars: { model: string; color: string } | null;
}

function carLabel(car: { model: string; color: string } | null): string {
  return car ? `${car.model} · ${car.color}` : "Unknown car";
}

function emptyValue(): ClientValue {
  return {
    rentals: 0,
    cancelled: 0,
    paidCents: 0,
    outstandingCents: 0,
    firstPickup: null,
    lastPickup: null,
    lastReturn: null,
    upcoming: 0,
  };
}

/**
 * Fold one booking into a client's running totals.
 *
 * MONEY IS SPLIT, NEVER SUMMED INTO ONE NUMBER: `paidCents` is what has been
 * collected, `outstandingCents` is what is owed. Refunded bookings land in
 * neither — the money came in and went back out, so counting it as lifetime
 * value would overstate what this guest is worth, and counting it as
 * outstanding would imply we are chasing it.
 */
function accumulate(value: ClientValue, b: RawBooking, nowTimestamp: string): void {
  if (!countsAsRental(b.booking_status)) {
    value.cancelled++;
    return;
  }

  value.rentals++;

  if (b.payment_status === "paid") value.paidCents += b.total_price;
  else if (b.payment_status === "unpaid" || b.payment_status === "pending") {
    value.outstandingCents += b.total_price;
  }

  if (!value.firstPickup || b.pickup_date < value.firstPickup) value.firstPickup = b.pickup_date;
  if (!value.lastPickup || b.pickup_date > value.lastPickup) value.lastPickup = b.pickup_date;
  if (!value.lastReturn || b.return_date > value.lastReturn) value.lastReturn = b.return_date;

  // Open on the same rule the fleet page uses: the return is still ahead of us,
  // or the car is physically out (an overdue rental is not a finished one).
  if (`${b.return_date}T${b.return_time}` > nowTimestamp || b.prep_status === "out") {
    value.upcoming++;
  }
}

/* ── the list ──────────────────────────────────────────────────────────────── */

/**
 * Every client, with their counts and their value, filtered and searched.
 *
 * Search and filtering happen in JS over the fetched set rather than in SQL,
 * for one concrete reason beyond the aggregate above: a phone typed as
 * "512 8823" has to find "+599 9 512 8823", and `ilike '%512 8823%'` does not.
 * Matching on normalised digits is the behaviour an admin expects and it cannot
 * be expressed against these columns without a functional index.
 */
export async function getClientsList(input: {
  query: string;
  filter: ClientFilter;
}): Promise<ClientsListData> {
  const now = curacaoNow();
  const db = supabaseAdmin();

  const [clientsRes, bookingsRes] = await Promise.all([
    db
      .from("clients")
      .select(CLIENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(CLIENT_FETCH_LIMIT),
    db.from("bookings").select(BOOKING_SELECT),
  ]);

  if (clientsRes.error) throw new Error(`Clients: failed to load: ${clientsRes.error.message}`);
  if (bookingsRes.error) {
    throw new Error(`Clients: failed to load bookings: ${bookingsRes.error.message}`);
  }

  const clients = (clientsRes.data ?? []) as unknown as RawClient[];
  const bookings = (bookingsRes.data ?? []) as unknown as RawBooking[];

  const values = new Map<string, ClientValue>();
  for (const b of bookings) {
    let value = values.get(b.client_id);
    if (!value) {
      value = emptyValue();
      values.set(b.client_id, value);
    }
    accumulate(value, b, now.timestamp);
  }

  // Duplicate candidates, computed once for the whole set by bucketing on the
  // two things that identify a person: their email and the tail of their phone.
  // Pairwise comparison would be O(n²); this is O(n) and finds the same pairs.
  const byEmail = new Map<string, string[]>();
  const byPhone = new Map<string, string[]>();
  for (const c of clients) {
    const email = normaliseEmail(c.email);
    const phone = normalisePhone(c.phone).slice(-8);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), c.id]);
    if (phone.length >= 8) byPhone.set(phone, [...(byPhone.get(phone) ?? []), c.id]);
  }
  // A set per client, not a running count: a pair that shares BOTH an email and
  // a phone appears in two groups, and "2 possible duplicates" for one other
  // record would be a lie.
  const duplicateOthers = new Map<string, Set<string>>();
  const linkGroup = (group: string[]) => {
    if (group.length < 2) return;
    for (const id of group) {
      const others = duplicateOthers.get(id) ?? new Set<string>();
      for (const other of group) if (other !== id) others.add(other);
      duplicateOthers.set(id, others);
    }
  };
  for (const group of byEmail.values()) linkGroup(group);
  for (const group of byPhone.values()) linkGroup(group);

  const all: ClientRow[] = clients.map((c) => {
    const value = values.get(c.id) ?? emptyValue();
    return {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      countryOfResidence: c.country_of_residence,
      licenseExpiry: c.license_expiry,
      licenceLevel: licenceLevel(c.license_expiry, now.today, value.lastReturn),
      isRepeat: isRepeatCustomer(value.rentals),
      value,
      possibleDuplicates: duplicateOthers.get(c.id)?.size ?? 0,
      createdAt: c.created_at,
    };
  });

  const totals = {
    clients: all.length,
    repeat: all.filter((c) => c.isRepeat).length,
    licenceAttention: all.filter((c) => needsLicenceAttention(c.licenceLevel)).length,
    duplicates: all.filter((c) => c.possibleDuplicates > 0).length,
  };

  const query = input.query.trim();
  const matched = all.filter((c) => {
    if (!matchesQuery(c, query)) return false;
    if (input.filter === "repeat") return c.isRepeat;
    if (input.filter === "licence") return needsLicenceAttention(c.licenceLevel);
    if (input.filter === "duplicates") return c.possibleDuplicates > 0;
    return true;
  });

  // Most recent activity first: the guest who rented last week is far more
  // likely to be the one being looked up than the one who rented in 2024. A
  // client with no bookings at all sorts by when they were created.
  matched.sort((a, b) => {
    const aKey = a.value.lastPickup ?? a.createdAt.slice(0, 10);
    const bKey = b.value.lastPickup ?? b.createdAt.slice(0, 10);
    return bKey.localeCompare(aKey) || a.fullName.localeCompare(b.fullName);
  });

  return {
    query,
    filter: input.filter,
    rows: matched.slice(0, DISPLAY_LIMIT),
    total: matched.length,
    totals,
    truncated: matched.length > DISPLAY_LIMIT || all.length >= CLIENT_FETCH_LIMIT,
    today: now.today,
  };
}

/* ── one client ────────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  // A malformed id is a miss, not a 500 — same rule as the booking detail: this
  // comes out of the address bar.
  if (!UUID_RE.test(clientId)) return null;

  const now = curacaoNow();
  const db = supabaseAdmin();

  const clientRes = await db.from("clients").select(CLIENT_SELECT).eq("id", clientId).maybeSingle();
  if (clientRes.error) throw new Error(`Client: failed to load: ${clientRes.error.message}`);
  if (!clientRes.data) return null;
  const client = clientRes.data as unknown as RawClient;

  const [bookingsRes, candidatesRes] = await Promise.all([
    db
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("client_id", clientId)
      .order("pickup_at", { ascending: false }),

    // Candidate duplicates: anyone sharing this email, plus anyone whose phone
    // ends the same way. Both are fetched loosely and confirmed in JS by
    // duplicateReason, so the normalisation rules live in one place.
    db
      .from("clients")
      .select(CLIENT_SELECT)
      .neq("id", clientId)
      // Values are double-quoted: a comma inside an address would otherwise be
      // read as the separator between two filters. The loose match here is
      // confirmed by duplicateReason below, which owns the actual rules.
      .or(
        `email.ilike."${normaliseEmail(client.email)}",phone.like."*${normalisePhone(client.phone).slice(-8)}*"`,
      )
      .limit(50),
  ]);

  if (bookingsRes.error) {
    throw new Error(`Client: failed to load bookings: ${bookingsRes.error.message}`);
  }
  if (candidatesRes.error) {
    throw new Error(`Client: failed to look for duplicates: ${candidatesRes.error.message}`);
  }

  const raw = (bookingsRes.data ?? []) as unknown as RawBooking[];
  const value = emptyValue();
  const carCounts = new Map<string, { carLabel: string; rentals: number }>();

  const bookings: ClientBooking[] = raw.map((b) => {
    accumulate(value, b, now.timestamp);

    if (countsAsRental(b.booking_status)) {
      const entry = carCounts.get(b.car_id);
      if (entry) entry.rentals++;
      else carCounts.set(b.car_id, { carLabel: carLabel(b.cars), rentals: 1 });
    }

    return {
      id: b.id,
      ref: b.id.slice(0, 8),
      carLabel: carLabel(b.cars),
      pickupDate: b.pickup_date,
      pickupTime: b.pickup_time,
      returnDate: b.return_date,
      returnTime: b.return_time,
      days: rentalDays(b.pickup_date, b.return_date),
      totalCents: b.total_price,
      bookingStatus: b.booking_status,
      paymentStatus: b.payment_status,
      prepStatus: b.prep_status,
      createdAt: b.created_at,
      isOpen:
        countsAsRental(b.booking_status) &&
        (`${b.return_date}T${b.return_time}` > now.timestamp || b.prep_status === "out"),
    };
  });

  // Confirm the loose SQL match against the real rules, and work out what
  // actually differs — the difference is the point, not the match.
  const candidates = (candidatesRes.data ?? []) as unknown as RawClient[];
  const duplicateIds = candidates.map((c) => c.id);

  const dupBookings = duplicateIds.length
    ? await db.from("bookings").select("client_id, booking_status").in("client_id", duplicateIds)
    : { data: [], error: null };
  if (dupBookings.error) {
    throw new Error(`Client: failed to count duplicate rentals: ${dupBookings.error.message}`);
  }

  const dupRentals = new Map<string, number>();
  for (const b of (dupBookings.data ?? []) as {
    client_id: string;
    booking_status: BookingStatus;
  }[]) {
    if (countsAsRental(b.booking_status)) {
      dupRentals.set(b.client_id, (dupRentals.get(b.client_id) ?? 0) + 1);
    }
  }

  const duplicates: DuplicateCandidate[] = [];
  for (const other of candidates) {
    const matchedOn = duplicateReason(client, other);
    if (!matchedOn) continue;

    const differs: DuplicateCandidate["differs"] = [];
    if (normaliseName(client.full_name) !== normaliseName(other.full_name)) differs.push("name");
    if (normaliseEmail(client.email) !== normaliseEmail(other.email)) differs.push("email");
    if (normalisePhone(client.phone) !== normalisePhone(other.phone)) differs.push("phone");
    if ((client.license_number ?? "") !== (other.license_number ?? "")) differs.push("licence");

    duplicates.push({
      id: other.id,
      fullName: other.full_name,
      email: other.email,
      phone: other.phone,
      rentals: dupRentals.get(other.id) ?? 0,
      createdAt: other.created_at,
      matchedOn,
      differs,
    });
  }

  return {
    id: client.id,
    fullName: client.full_name,
    email: client.email,
    phone: client.phone,
    licenseNumber: client.license_number,
    licenseExpiry: client.license_expiry,
    dateOfBirth: client.date_of_birth,
    countryOfResidence: client.country_of_residence,
    createdAt: client.created_at,
    updatedAt: client.updated_at,
    today: now.today,
    isRepeat: isRepeatCustomer(value.rentals),
    licenceLevel: licenceLevel(client.license_expiry, now.today, value.lastReturn),
    value,
    bookings,
    favouriteCars: [...carCounts.entries()]
      .map(([carId, entry]) => ({ carId, ...entry }))
      .sort((a, b) => b.rentals - a.rentals || a.carLabel.localeCompare(b.carLabel)),
    duplicates,
  };
}
