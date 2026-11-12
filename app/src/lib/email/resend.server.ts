/**
 * Resend, over its HTTP API. Server only: the `.server.ts` suffix keeps this
 * file, and RESEND_API_KEY with it, out of the client bundle.
 *
 * Plain fetch rather than the `resend` SDK: one POST is the whole integration,
 * and a fetch is trivially stubbed when verifying the failure paths.
 *
 * NEVER THROWS. Every outcome, including "not configured yet" and "provider
 * down", comes back as a value, because the caller is the booking flow and an
 * email problem must never become a booking problem. Deciding what to log is
 * the caller's job; this function never logs the key, and neither may anyone
 * who edits it.
 *
 * Env is read INSIDE the function (see lib/supabase/admin.server.ts for why).
 */
import process from "node:process";

import { BUSINESS_NAME, CONTACT } from "../../content/brand";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Long enough for a healthy Resend (well under a second), short enough that a
 *  hung one cannot hold a guest's "Reserving your car" spinner for long. */
const SEND_TIMEOUT_MS = 6_000;

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where replies go. Omit it to use the configured CW reply-to address
   *  (EMAIL_REPLY_TO); pass an address to override, or null for none. */
  replyTo?: string | null;
  /** Resend drops a repeat send with the same key for 24h, so a retried
   *  request cannot email a guest twice about one booking. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_configured"; message: string }
  | { ok: false; reason: "provider_error"; status: number; message: string }
  | { ok: false; reason: "network_error"; message: string };

/**
 * WHO MAIL IS FROM, WHERE REPLIES GO, AND WHO GETS ALERTS.
 *
 * Three env vars, each optional, each defaulting to CW's own address from
 * CONTACT (src/content/brand.ts), so no address is typed in the email code:
 *
 *   EMAIL_FROM          the sender, e.g. "CW Car Sales & Rental <info@…>".
 *                       Must be on a domain verified in Resend.
 *   EMAIL_REPLY_TO      where a guest's reply lands.
 *   ADMIN_NOTIFY_EMAIL  where new-booking alerts go.
 *
 * None of these switches email on. That is RESEND_API_KEY alone (see
 * emailConfig): without the key nothing is sent, whatever these say.
 */
export function emailAddresses(): { from: string; replyTo: string; adminNotify: string } {
  return {
    from: process.env.EMAIL_FROM?.trim() || `${BUSINESS_NAME} <${CONTACT.email}>`,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || CONTACT.email,
    adminNotify: process.env.ADMIN_NOTIFY_EMAIL?.trim() || CONTACT.email,
  };
}

/** The configured sender, or null when email is not switched on yet. The API
 *  key is the switch: until it is set, every send is a clean no-op. */
export function emailConfig(): { apiKey: string; from: string; replyTo: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const { from, replyTo } = emailAddresses();
  return { apiKey, from, replyTo };
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const config = emailConfig();
  if (!config) {
    return {
      ok: false,
      reason: "not_configured",
      message: "RESEND_API_KEY is not set (see .env.example).",
    };
  }

  // undefined = "use CW's reply-to"; null = "no reply-to header at all".
  const replyTo = email.replyTo === undefined ? config.replyTo : email.replyTo;

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  // Resend answers JSON both ways: { id } on success, { name, message } on error.
  const body = (await response.json().catch(() => null)) as {
    id?: string;
    name?: string;
    message?: string;
  } | null;

  if (response.ok && body?.id) return { ok: true, id: body.id };
  return {
    ok: false,
    reason: "provider_error",
    status: response.status,
    message: [body?.name, body?.message].filter(Boolean).join(": ") || response.statusText,
  };
}
