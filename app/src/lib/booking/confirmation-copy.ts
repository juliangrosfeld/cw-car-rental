/**
 * What a guest is told once a booking exists. ONE source for the wording, so
 * the confirmation screen and the confirmation email say the same thing.
 *
 * The confirmation email (Resend, not built yet) must take its subject,
 * headline and body from here rather than writing its own: a guest who reads
 * "you're confirmed" on the screen and "we'll confirm shortly" in their inbox
 * has been told two different things about the same booking.
 *
 * THE FRAMING. A booking is confirmed the moment it is created (see
 * createBooking): the times offered were free and the database refuses any
 * double booking. So nothing here promises a later confirmation step. WhatsApp
 * is where to reach us with questions or changes, not a step still to come.
 *
 * Plain strings, no JSX: this is imported by the browser and will be by the
 * server-side email. Keep rendered copy free of em dashes.
 */
import type { BookingStatus, PaymentStatus } from "../supabase/types";
import { fmtDay, fmtTime, fromKey } from "./rental";

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
