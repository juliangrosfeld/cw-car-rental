/**
 * Typed mirror of the Postgres schema in supabase/migrations/ (0001 init through
 * 0005 listings + vehicles).
 *
 * Hand-maintained for now. Once the project is linked to a Supabase project you
 * can replace this file wholesale with generated output:
 *
 *   bunx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 *
 * Keep the shapes in sync with the migration by hand until then — the migration
 * is authoritative, this file is just what the app codes against.
 *
 * TWO LEVELS, SINCE 0005 — read this before touching `cars`.
 *   cars      a LISTING. What a guest browses and books: model, category,
 *             photo, the two rates. One row per thing CW advertises.
 *   vehicles  a PHYSICAL car. Plate, colour, condition, and a key exactly one
 *             guest can hold at a time. Several may back one listing.
 * `Car` below is therefore a listing, kept under that name because its id is
 * still the FLEET slug every URL and booking already uses.
 *
 * CONVENTIONS (same as the migration)
 *   money   integer CENTS of XCG, never floats. 6000 == XCG 60.00.
 *   dates   'YYYY-MM-DD'; times 'HH:MM:SS' (Postgres `date` / `time`).
 *   ids     listings use the FLEET slugs from src/content/brand.ts; everything
 *           else, vehicles included, is a uuid.
 */

/** Standing availability of a PHYSICAL car. Lived on `cars` until 0005 moved it
 *  to `vehicles`, where it belongs: a listing is not in the shop, a car is. */
export const VEHICLE_STATUS = ["available", "maintenance", "offline"] as const;
export const BOOKING_STATUS = ["pending", "confirmed", "active", "completed", "cancelled"] as const;
export const PAYMENT_STATUS = ["unpaid", "pending", "paid", "refunded"] as const;
export const PREP_STATUS = ["booked", "needs_prep", "ready", "out", "returned"] as const;
export const TRANSMISSION = ["Automatic", "Manual"] as const;
/** Which product was sold — see bookings.rental_type in migration 0004. The
 *  vocabulary itself lives in src/lib/booking/rental.ts, which is where the
 *  pricing rules that give it meaning are. */
export const RENTAL_TYPE = ["daily", "monthly"] as const;

export type VehicleStatus = (typeof VEHICLE_STATUS)[number];
export type BookingStatus = (typeof BOOKING_STATUS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export type PrepStatus = (typeof PREP_STATUS)[number];
export type Transmission = (typeof TRANSMISSION)[number];
export type RentalTypeValue = (typeof RENTAL_TYPE)[number];

/** Every status except `cancelled` still occupies the VEHICLE — mirrors the
 *  partial WHERE clause on the bookings exclusion constraint, which keys on
 *  vehicle_id since 0005. */
export const BLOCKING_BOOKING_STATUSES = ["pending", "confirmed", "active", "completed"] as const;

export interface Database {
  public: {
    Tables: {
      /** A LISTING — see the note at the top of this file. */
      cars: {
        Row: {
          /** FLEET slug, e.g. "hyundai-venue-red". */
          id: string;
          model: string;
          category: string;
          /** The colour in the LISTING'S PHOTO, i.e. what the site says the car
           *  looks like. Not necessarily the colour of the unit a guest is
           *  handed — that is `vehicles.color`. */
          color: string;
          /** Cents per rental day. A daily rental is days x this; see
           *  quoteRental in ../booking/rental. */
          daily_rate: number;
          /** Cents for a ~30-day monthly rental. Flat, NOT 30 x daily_rate.
           *  0 means this car is not offered monthly. */
          monthly_rate: number;
          transmission: Transmission;
          seats: number;
          photo_url: string;
          /** Guest-facing copy. Null until someone writes it in the CRM. */
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          model: string;
          category: string;
          color: string;
          daily_rate: number;
          monthly_rate?: number;
          transmission?: Transmission;
          seats: number;
          photo_url: string;
          description?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cars"]["Insert"]>;
        Relationships: [];
      };
      /** A PHYSICAL car backing a listing. */
      vehicles: {
        Row: {
          id: string;
          /** FK to cars.id — the listing this car is rented out as. */
          listing_id: string;
          /** Null means "not on file yet", not "no plate". */
          plate_number: string | null;
          color: string;
          /**
           * True for the one unit whose photo the listing shows; false for a
           * backup that exists as capacity rather than as a choice. Does NOT
           * affect whether the listing is bookable — a hidden unit is counted
           * in availability exactly like a visible one, it is simply assigned
           * second.
           */
          is_publicly_visible: boolean;
          status: VehicleStatus;
          /**
           * INTERNAL — why this car is off the road, what was done to it. The
           * anon role holds no privilege on this TABLE at all (migration 0005),
           * so nothing here can reach a public payload.
           */
          maintenance_notes: string | null;
          /** ISO instant it last left 'available', or null while on the road. */
          off_road_since: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          plate_number?: string | null;
          color: string;
          is_publicly_visible?: boolean;
          status?: VehicleStatus;
          maintenance_notes?: string | null;
          off_road_since?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["vehicles"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "vehicles_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          id: string;
          full_name: string;
          phone: string;
          email: string;
          license_number: string | null;
          /** 'YYYY-MM-DD' */
          license_expiry: string | null;
          /** Object key in the private `license-photos` bucket (0007). */
          license_photo_path: string | null;
          date_of_birth: string | null;
          country_of_residence: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          phone: string;
          email: string;
          license_number?: string | null;
          license_expiry?: string | null;
          license_photo_path?: string | null;
          date_of_birth?: string | null;
          country_of_residence?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          client_id: string;
          /** The LISTING that was sold. Held in step with `vehicle_id` by the
           *  composite FK bookings_vehicle_listing_fkey. */
          car_id: string;
          /** The PHYSICAL car assigned. What the double-booking constraint
           *  keys on, and what the guest is actually handed. */
          vehicle_id: string;
          /** 'YYYY-MM-DD' */
          pickup_date: string;
          /** 'HH:MM:SS' */
          pickup_time: string;
          return_date: string;
          return_time: string;
          /** Generated: pickup_date + pickup_time. Read-only. */
          pickup_at: string;
          /** Generated: return_date + return_time. Read-only. */
          return_at: string;
          pickup_location: string;
          return_location: string;
          flight_number: string | null;
          /** Cents, the final total the guest owes, as struck at booking time. */
          total_price: number;
          /** Which product was sold. A 30-day daily rental and a monthly rental
           *  look identical on a calendar and cost very differently. */
          rental_type: RentalTypeValue;
          /** HISTORIC. Length discounts were removed in Nov 2026: every booking
           *  since writes 0. Bookings made before then keep the tier that was
           *  applied to them, which is why the column is not dropped. */
          discount_pct: number;
          /** HISTORIC, as above. Cents that were taken off an older booking;
           *  its pre-discount total is total_price + this. 0 on every new one. */
          discount_cents: number;
          booking_status: BookingStatus;
          payment_status: PaymentStatus;
          prep_status: PrepStatus;
          /** Customer-facing. Safe to echo back to the guest. */
          special_requests: string | null;
          /** INTERNAL ONLY — never expose on a public route or in a guest email. */
          admin_notes: string | null;
          handled_by: string | null;
          /** ISO instant the guest accepted the Terms & Conditions in the
           *  wizard (0008). Null for admin-made and older bookings. */
          accepted_terms_at: string | null;
          /** Custom total an admin set on a manual booking (0009), cents.
           *  Null on every booking priced from the price list. */
          price_override_cents: number | null;
          /** Optional reason for the custom price. INTERNAL. */
          price_override_note: string | null;
          /** What the price list would have charged, captured when a custom
           *  price was set. Null otherwise. */
          standard_price_cents: number | null;
          /** ISO instant the after-care (thank you / review) email was
           *  successfully sent (0010). Null = not sent. Set once. */
          aftercare_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          car_id: string;
          vehicle_id: string;
          pickup_date: string;
          pickup_time: string;
          return_date: string;
          return_time: string;
          pickup_location: string;
          return_location: string;
          flight_number?: string | null;
          total_price: number;
          rental_type?: RentalTypeValue;
          discount_pct?: number;
          discount_cents?: number;
          booking_status?: BookingStatus;
          payment_status?: PaymentStatus;
          prep_status?: PrepStatus;
          special_requests?: string | null;
          admin_notes?: string | null;
          handled_by?: string | null;
          accepted_terms_at?: string | null;
          price_override_cents?: number | null;
          price_override_note?: string | null;
          standard_price_cents?: number | null;
          aftercare_sent_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "bookings_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_vehicle_listing_fkey";
            columns: ["vehicle_id", "car_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "listing_id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          booking_id: string;
          /** Cents, signed: positive for a charge, negative for a refund. */
          amount: number;
          method: string;
          status: PaymentStatus;
          provider_transaction_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          amount: number;
          method: string;
          status?: PaymentStatus;
          provider_transaction_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      /** One-time admin invite links. Service role only (RLS on, no policies). */
      admin_invites: {
        Row: {
          id: string;
          /** SHA-256 hex of the token in the link. The token itself is never stored. */
          token_hash: string;
          expires_at: string;
          used_at: string | null;
          used_by_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          token_hash: string;
          expires_at: string;
          used_at?: string | null;
          used_by_email?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["admin_invites"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean };
    };
    Enums: Record<never, never>;
  };
}

/** A LISTING. Named `Car` because its id is the FLEET slug the whole app is
 *  already keyed on; see the two-levels note at the top of this file. */
export type Car = Database["public"]["Tables"]["cars"]["Row"];
export type NewCar = Database["public"]["Tables"]["cars"]["Insert"];
export type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
export type NewVehicle = Database["public"]["Tables"]["vehicles"]["Insert"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type NewClient = Database["public"]["Tables"]["clients"]["Insert"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type NewBooking = Database["public"]["Tables"]["bookings"]["Insert"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type NewPayment = Database["public"]["Tables"]["payments"]["Insert"];
