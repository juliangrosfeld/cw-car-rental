/**
 * What happens in email when a booking is created: the guest gets their
 * confirmation, Clay gets an alert. Called by submitBooking after createBooking
 * has returned ok, which means the car is already held in the database.
 *
 * THE RULE: THIS FUNCTION CANNOT FAIL A BOOKING. It never throws (rendering and
 * sending are both inside a try per email), and the two sends run side by side
 * so one failing does not stop the other. The booking response waits
 * for them, bounded by resend.server's timeout, rather than firing and
 * forgetting: on Vercel a function can be frozen the moment it responds, and an
 * email still in flight then is an email silently never sent.
 *
 * NOT SILENT. Every outcome is one line on the server log (Vercel: Project →
 * Logs, filter "[email]"). A skipped send because the key is not set yet is a
 * warning, a failed send is an error, and both carry the booking id so the
 * guest can be contacted by hand.
 */
import process from "node:process";

import type { BookingConfirmation } from "../booking/availability.server";
import { renderAdminAlert, renderGuestConfirmation, type RenderedEmail } from "./booking-emails";
import { sendEmail, type SendResult } from "./resend.server";

export interface BookingNotificationOutcome {
  guest: SendResult;
  admin: SendResult;
}

export async function notifyNewBooking(
  confirmation: BookingConfirmation,
  context: { origin: string | null; specialRequests: string | null },
): Promise<BookingNotificationOutcome> {
  const id = confirmation.bookingId;
  const adminTo = process.env.ADMIN_NOTIFY_EMAIL?.trim() || null;

  const attempt = async (
    kind: "guest-confirmation" | "admin-alert",
    to: string | null,
    render: () => RenderedEmail,
    replyTo: string | null,
  ): Promise<SendResult> => {
    let result: SendResult;
    try {
      if (!to) {
        result = {
          ok: false,
          reason: "not_configured",
          message: "ADMIN_NOTIFY_EMAIL is not set (see .env.example).",
        };
      } else {
        const email = render();
        result = await sendEmail({
          to,
          ...email,
          replyTo,
          idempotencyKey: `booking/${id}/${kind}`,
        });
      }
    } catch (error) {
      // A rendering bug, most likely. Still not the booking's problem.
      result = {
        ok: false,
        reason: "network_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (result.ok) {
      console.info(`[email] ${kind} sent booking=${id} resend_id=${result.id}`);
    } else if (result.reason === "not_configured") {
      console.warn(`[email] ${kind} SKIPPED booking=${id}: ${result.message}`);
    } else {
      console.error(
        `[email] ${kind} FAILED booking=${id} reason=${result.reason}` +
          ("status" in result ? ` status=${result.status}` : "") +
          `: ${result.message}`,
      );
    }
    return result;
  };

  const adminUrl = context.origin ? `${context.origin}/admin/bookings/${id}` : null;

  const [guest, admin] = await Promise.all([
    // Replies from the guest go to Clay, not to a no-reply sender.
    attempt(
      "guest-confirmation",
      confirmation.client.email,
      () => renderGuestConfirmation(confirmation),
      adminTo,
    ),
    // Replies from Clay go straight to the guest.
    attempt(
      "admin-alert",
      adminTo,
      () => renderAdminAlert(confirmation, { adminUrl, specialRequests: context.specialRequests }),
      confirmation.client.email,
    ),
  ]);
  return { guest, admin };
}
