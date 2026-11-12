/**
 * Sends the after-care email when a booking is marked Returned. Server only.
 *
 * THE RULES, each of which is a line in Clay's brief:
 *
 *   IT CANNOT FAIL OR SLOW THE RETURN. This is called AFTER the Returned
 *   transition has been written, it never throws, and the one network call in
 *   it is bounded by resend.server's 6 second timeout. Whatever happens here,
 *   the car is already checked in.
 *
 *   EXACTLY ONCE. bookings.aftercare_sent_at is stamped only after the mail
 *   provider accepts the message, and a booking that already has it is skipped.
 *   Moving the pipeline back to Out and forward to Returned again sends
 *   nothing. Two clicks landing in the same second are covered by Resend's
 *   idempotency key (one booking, one key), which drops the duplicate.
 *
 *   A FAILED SEND IS NOT A SENT ONE. If the provider refuses or times out, the
 *   stamp stays NULL, so marking the booking Returned again retries it.
 *
 *   NO LINK, NO EMAIL. Without REVIEW_URL the message would ask for a review
 *   and offer nowhere to leave one, so nothing is sent and a warning is logged.
 *
 *   NO RESEND_API_KEY = a clean no-op with a log line, like every other email.
 *
 * Every outcome is one line under "[email]" in the server log.
 */
import process from "node:process";

import { locationLabel } from "../../content/brand";
import { firstName } from "../booking/confirmation-copy";
import { supabaseAdmin } from "../supabase/admin.server";
import { renderAftercare } from "./aftercare-email";
import { emailConfig, sendEmail } from "./resend.server";

export type AftercareOutcome =
  | "sent"
  | "already_sent"
  | "no_review_url"
  | "not_configured"
  | "not_applicable"
  | "failed";

/** REVIEW_URL, if it is a real http(s) link. Anything else counts as unset: a
 *  typo here would otherwise go out to every guest as a dead link. */
export function reviewUrl(): string | null {
  const raw = process.env.REVIEW_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function notifyBookingReturned(bookingId: string): Promise<AftercareOutcome> {
  const tag = `[email] aftercare`;
  try {
    const db = supabaseAdmin();
    const { data: booking, error } = await db
      .from("bookings")
      .select(
        "id, booking_status, aftercare_sent_at, pickup_location, return_location, clients ( full_name, email )",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const client = booking?.clients as unknown as { full_name: string; email: string } | null;
    if (!booking || !client?.email) {
      console.warn(`${tag} SKIPPED booking=${bookingId}: no booking or no guest email on file`);
      return "not_applicable";
    }
    // A cancelled booking has no rental to thank anyone for.
    if (booking.booking_status === "cancelled") {
      console.warn(`${tag} SKIPPED booking=${bookingId}: booking is cancelled`);
      return "not_applicable";
    }
    if (booking.aftercare_sent_at) {
      console.info(
        `${tag} SKIPPED booking=${bookingId}: already sent at ${booking.aftercare_sent_at}`,
      );
      return "already_sent";
    }

    const link = reviewUrl();
    if (!link) {
      console.warn(
        `${tag} SKIPPED booking=${bookingId}: REVIEW_URL is not set (or is not a valid link), ` +
          "so the thank-you email was not sent. Set it in the environment (see .env.example).",
      );
      return "no_review_url";
    }
    if (!emailConfig()) {
      console.warn(
        `${tag} SKIPPED booking=${bookingId}: RESEND_API_KEY is not set (see .env.example). ` +
          `Would have thanked the guest for the rental from ${locationLabel(booking.pickup_location)} ` +
          `to ${locationLabel(booking.return_location)}.`,
      );
      return "not_configured";
    }

    const email = renderAftercare({ firstName: firstName(client.full_name), reviewUrl: link });
    // replyTo omitted on purpose: sendEmail then uses CW's own reply-to
    // address (EMAIL_REPLY_TO), which is where "please reply here" must land.
    const result = await sendEmail({
      to: client.email,
      ...email,
      idempotencyKey: `booking/${bookingId}/aftercare`,
    });

    if (!result.ok) {
      console.error(
        `${tag} FAILED booking=${bookingId} reason=${result.reason}` +
          ("status" in result ? ` status=${result.status}` : "") +
          `: ${result.message}`,
      );
      return "failed";
    }

    // Stamp it. `is null` in the filter keeps the first timestamp if two
    // requests got this far together.
    const { error: stampError } = await db
      .from("bookings")
      .update({ aftercare_sent_at: new Date().toISOString() })
      .eq("id", bookingId)
      .is("aftercare_sent_at", null);
    if (stampError) {
      // The email went out; only the record of it failed. Say so loudly: the
      // idempotency key protects against a duplicate for 24 hours, not forever.
      console.error(
        `${tag} SENT booking=${bookingId} resend_id=${result.id} BUT could not record it: ${stampError.message}`,
      );
    } else {
      console.info(`${tag} sent booking=${bookingId} resend_id=${result.id}`);
    }
    return "sent";
  } catch (error) {
    console.error(
      `${tag} FAILED booking=${bookingId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "failed";
  }
}
