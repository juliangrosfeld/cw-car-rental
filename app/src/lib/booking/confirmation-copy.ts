/**
 * What a guest is told once a booking exists. ONE source for the wording, so
 * the confirmation screen and the confirmation email say the same thing.
 *
 * The confirmation email (src/lib/email/booking-emails.ts) takes its subject,
 * headline, body AND its table of facts from here rather than writing its own:
 * a guest who reads "you're confirmed" on the screen and "we'll confirm
 * shortly" in their inbox has been told two different things about the same
 * booking. confirmationRows() is the table both of them print.
 *
 * THE FRAMING. A booking is confirmed the moment it is created (see
 * createBooking): the times offered were free and the database refuses any
 * double booking. So nothing here promises a later confirmation step. WhatsApp
 * is where to reach us with questions or changes, not a step still to come.
 *
 * Plain strings, no JSX: this is imported by the browser and will be by the
 * server-side email. Keep rendered copy free of em dashes.
 */
import { formatMoney } from "../money";
import type { BookingStatus, PaymentStatus } from "../supabase/types";
import { fmtDay, fmtTime, fromKey, type RentalType } from "./rental";

export interface ConfirmationFacts {
  fullName: string;
  carModel: string;
  /** 'YYYY-MM-DD' */
  pickupDate: string;
  /** 'HH:MM:SS' */
  pickupTime: string;
  /** 'YYYY-MM-DD' */
  returnDate: string;
  /** 'HH:MM:SS' */
  returnTime: string;
  pickupLocation: string;
  /** Short, human handle for the booking; the full uuid is the real key. */
  reference: string;
}

/** Short, readable handle for WhatsApp; the full uuid is the real key. */
export function bookingReference(bookingId: string): string {
  return bookingId.slice(0, 8).toUpperCase();
}

/** The no-tax, no-fees promise. Shown under the price on the review step and
 *  repeated in the confirmation email under the total. */
export const FULL_PRICE_NOTE = "This is the full price. Nothing is added at pickup.";

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "friend";
}

/** The guest-facing words for a confirmed booking. */
export function confirmationCopy(f: ConfirmationFacts) {
  const pickup = `${fmtDay(fromKey(f.pickupDate))} at ${fmtTime(f.pickupTime)}`;
  const dropoff = `${fmtDay(fromKey(f.returnDate))} at ${fmtTime(f.returnTime)}`;
  return {
    /** Email subject line. */
    subject: `You're confirmed: ${f.carModel}, ${fmtDay(fromKey(f.pickupDate))} (ref ${f.reference})`,
    headline: `You're confirmed, ${firstName(f.fullName)}!`,
    summary: `The ${f.carModel} is yours from ${pickup} to ${dropoff}, keys at ${f.pickupLocation}. Masha danki for booking with us.`,
    contact: `Questions or changes? Message us on WhatsApp and mention reference ${f.reference}.`,
  };
}

/** What confirmationRows needs: a structural slice of BookingConfirmation, so
 *  the browser's serialised copy and the server's original both fit. */
export interface ConfirmationDetails {
  bookingId: string;
  car: { model: string; color: string; transmission: string; seats: number };
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  pickupLocation: string;
  returnLocation: string;
  flightNumber: string | null;
  rentalType: RentalType;
  days: number;
  rateCents: number;
  discountPct: number;
  discountCents: number;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
}

export interface ConfirmationRow {
  label: string;
  value: string;
  /** Smaller lines under the value. `emphasis` marks the one worth noticing
   *  (a discount), which the screen tints and the email bolds. */
  details: { text: string; emphasis?: boolean }[];
}

/** The facts of a confirmed booking, in the order the guest reads them. */
export function confirmationRows(c: ConfirmationDetails): ConfirmationRow[] {
  const dayCount = `${c.days} ${c.days === 1 ? "day" : "days"}`;
  const payment = paymentLabel(c.paymentStatus);
  const rows: ConfirmationRow[] = [
    { label: "Reference", value: bookingReference(c.bookingId), details: [] },
    {
      label: "Car",
      value: `${c.car.model}, ${c.car.color.toLowerCase()} · ${c.car.transmission} · ${c.car.seats} seats`,
      details: [],
    },
    {
      label: "Pickup",
      value: `${fmtDay(fromKey(c.pickupDate))} at ${fmtTime(c.pickupTime)} · ${c.pickupLocation}`,
      details: [],
    },
    {
      label: "Drop-off",
      value: `${fmtDay(fromKey(c.returnDate))} at ${fmtTime(c.returnTime)} · ${c.returnLocation}`,
      details: [],
    },
  ];
  if (c.flightNumber) rows.push({ label: "Flight", value: c.flightNumber, details: [] });
  rows.push(
    {
      label: "Rental",
      value:
        c.rentalType === "monthly"
          ? `Monthly rate · ${c.days} day period`
          : `By the day · ${dayCount}`,
      details: [],
    },
    {
      label: "Total",
      value: formatMoney(c.totalCents),
      details: [
        {
          text:
            c.rentalType === "monthly"
              ? "flat monthly rate"
              : `${formatMoney(c.rateCents)} × ${dayCount}`,
        },
        ...(c.discountCents > 0
          ? [
              {
                text: `${c.discountPct}% long stay discount, ${formatMoney(c.discountCents)} off`,
                emphasis: true,
              },
            ]
          : []),
      ],
    },
    { label: "Status", value: BOOKING_STATUS_LABEL[c.bookingStatus], details: [] },
    {
      label: "Payment",
      value: payment.label,
      details: payment.note ? [{ text: payment.note }] : [],
    },
  );
  return rows;
}

/** How a booking status reads to a guest. */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Reserved, not yet confirmed",
  confirmed: "Confirmed",
  active: "On the road",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** How payment reads to a guest. Nothing is ever charged online yet, so every
 *  state short of `paid` means "at pickup". */
export function paymentLabel(status: PaymentStatus): { label: string; note?: string } {
  if (status === "paid") return { label: "Paid, thank you" };
  if (status === "refunded") return { label: "Refunded" };
  return { label: "Pay at pickup", note: "Nothing has been charged online." };
}
