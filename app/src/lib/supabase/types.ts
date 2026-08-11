/**
 * Typed mirror of the Postgres schema in supabase/migrations/0001_init.sql.
 *
 * Hand-maintained for now. Once the project is linked to a Supabase project you
 * can replace this file wholesale with generated output:
 *
 *   bunx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 *
 * Keep the shapes in sync with the migration by hand until then — the migration
 * is authoritative, this file is just what the app codes against.
 *
 * CONVENTIONS (same as the migration)
 *   money   integer CENTS of XCG, never floats. 6000 == XCG 60.00.
 *   dates   'YYYY-MM-DD'; times 'HH:MM:SS' (Postgres `date` / `time`).
 *   ids     cars use the FLEET slugs from src/content/brand.ts; everything
 *           else is a uuid.
 */

export const CAR_STATUS = ["available", "maintenance", "offline"] as const;
export const BOOKING_STATUS = [
  "pending",
  "confirmed",
  "active",
  "completed",
  "cancelled",
] as const;
export const PAYMENT_STATUS = ["unpaid", "pending", "paid", "refunded"] as const;
export const PREP_STATUS = ["booked", "needs_prep", "ready", "out", "returned"] as const;
export const TRANSMISSION = ["Automatic", "Manual"] as const;
/** Which product was sold — see bookings.rental_type in migration 0004. The
 *  vocabulary itself lives in src/lib/booking/rental.ts, which is where the
 *  pricing rules that give it meaning are. */
export const RENTAL_TYPE = ["daily", "monthly"] as const;

export type CarStatus = (typeof CAR_STATUS)[number];
export type BookingStatus = (typeof BOOKING_STATUS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export type PrepStatus = (typeof PREP_STATUS)[number];
export type Transmission = (typeof TRANSMISSION)[number];
export type RentalTypeValue = (typeof RENTAL_TYPE)[number];

/** Every status except `cancelled` still occupies the car — mirrors the
 *  partial WHERE clause on the bookings exclusion constraint. */
export const BLOCKING_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "active",
  "completed",
] as const;

export interface Database {
  public: {
    Tables: {
      cars: {
        Row: {
          /** FLEET slug, e.g. "hyundai-venue-red". */
          id: string;
          model: string;
          category: string;
          color: string;
          /** Cents per rental day, undiscounted. Length discounts are applied
           *  on top by the server — see DISCOUNT_TIERS in ../booking/rental. */
          daily_rate: number;
          /** Cents for a ~30-day monthly rental. Flat, NOT 30 x daily_rate.
           *  0 means this car is not offered monthly. */
          monthly_rate: number;
          transmission: Transmission;
          seats: number;
          photo_url: string;
          status: CarStatus;
          /**
           * INTERNAL — why the car is off the road, what was done to it.
           * The anon role holds no privilege on this column (migration 0003), so
           * it must never be selected with the anon client and must never be put
           * on a public payload.
           */
          maintenance_notes: string | null;
          /** ISO instant the car last left 'available', or null while on the road. */
          off_road_since: string | null;
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
          status?: CarStatus;
          maintenance_notes?: string | null;
          off_road_since?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cars"]["Insert"]>;
        Relationships: [];
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
          car_id: string;
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
          /** Cents, quoted at booking time and already NET of any discount. */
          total_price: number;
          /** Which product was sold. A 30-day daily rental and a monthly rental
           *  look identical on a calendar and cost very differently. */
          rental_type: RentalTypeValue;
          /** The length-discount tier that applied, 0 if none. As struck. */
          discount_pct: number;
          /** Cents taken off. Pre-discount total is total_price + this. */
          discount_cents: number;
          booking_status: BookingStatus;
          payment_status: PaymentStatus;
          prep_status: PrepStatus;
          /** Customer-facing. Safe to echo back to the guest. */
          special_requests: string | null;
          /** INTERNAL ONLY — never expose on a public route or in a guest email. */
          admin_notes: string | null;
          handled_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          car_id: string;
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
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean };
    };
    Enums: Record<never, never>;
  };
}

export type Car = Database["public"]["Tables"]["cars"]["Row"];
export type NewCar = Database["public"]["Tables"]["cars"]["Insert"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type NewClient = Database["public"]["Tables"]["clients"]["Insert"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type NewBooking = Database["public"]["Tables"]["bookings"]["Insert"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type NewPayment = Database["public"]["Tables"]["payments"]["Insert"];
