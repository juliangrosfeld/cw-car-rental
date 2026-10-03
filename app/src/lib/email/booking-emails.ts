/**
 * The two emails a new booking sends, rendered to { subject, html, text }.
 *
 * Pure functions, no I/O and no env: sending lives in ./resend.server, the
 * decision of what to send and when in ./notify-booking.server. Keeping the
 * rendering pure is what lets scripts/preview-booking-emails.ts render real
 * bookings to disk without a provider.
 *
 * GUEST EMAIL WORDING IS NOT WRITTEN HERE. Subject, headline, summary, the
 * table of facts and the contact line all come from booking/confirmation-copy,
 * the same functions the confirmation screen renders. This file only lays them
 * out. Need a new sentence in the guest email? Add it to confirmation-copy and
 * put it on the screen too, or the two will drift.
 *
 * The admin alert is internal and has no screen twin, so its labels live here.
 *
 * Everything interpolated into HTML goes through esc(): names, flight numbers
 * and special requests are typed by whoever is on the internet.
 */
import { CONTACT } from "../../content/brand";
import type { BookingConfirmation } from "../booking/availability.server";
import {
  FULL_PRICE_NOTE,
  bookingReference,
  confirmationCopy,
  confirmationRows,
  paymentLabel,
  type ConfirmationRow,
} from "../booking/confirmation-copy";
import { fmtDay, fmtTime, fromKey } from "../booking/rental";
import { formatMoney } from "../money";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/* Brand colours, from src/styles.css. Email clients ignore CSS variables. */
const NAVY = "#023047";
const INK = "#1c3a4a";
const TEAL = "#118c8c";
const TEAL_DARK = "#0c6b6b";
const MINT_SOFT = "#eef7f3";
const RULE = "#d9e3e7";

const WHATSAPP_URL = `https://wa.me/${CONTACT.whatsapp.replace(/\D/g, "")}`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subjects are one line. A newline in a guest's name must not become a header. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function rowsHtml(rows: ConfirmationRow[]): string {
  return rows
    .map(
      (r) => `<tr>
  <td style="padding:12px 0;border-top:1px solid ${RULE};font-weight:700;color:${NAVY};vertical-align:top;white-space:nowrap;padding-right:16px;">${esc(r.label)}</td>
  <td style="padding:12px 0;border-top:1px solid ${RULE};color:${INK};text-align:right;">${esc(r.value)}${r.details
    .map(
      (d) =>
        `<br><span style="font-size:12px;${d.emphasis ? `font-weight:700;color:${TEAL_DARK};` : "color:#5b7380;"}">${esc(d.text)}</span>`,
    )
    .join("")}</td>
</tr>`,
    )
    .join("\n");
}

function rowsText(rows: ConfirmationRow[]): string {
  return rows
    .map((r) => [`${r.label}: ${r.value}`, ...r.details.map((d) => `  ${d.text}`)].join("\n"))
    .join("\n");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;">
<tr><td style="padding:32px 28px;">
${body}
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#7a8f99;">CW Car Rental · Curaçao</p>
</td></tr>
</table>
</body>
</html>`;
}

/* ── guest ─────────────────────────────────────────────────────────────────── */

/** The guest's confirmation. Same headline, summary, rows and contact line as
 *  the confirmation screen, plus the full-price note from the review step. */
export function renderGuestConfirmation(c: BookingConfirmation): RenderedEmail {
  const reference = bookingReference(c.bookingId);
  const copy = confirmationCopy({
    fullName: c.client.full_name,
    carModel: c.car.model,
    pickupDate: c.pickupDate,
    pickupTime: c.pickupTime,
    returnDate: c.returnDate,
    returnTime: c.returnTime,
    pickupLocation: c.pickupLocation,
    reference,
  });
  const rows = confirmationRows(c);
  const whatsapp = `${WHATSAPP_URL}?text=${encodeURIComponent(`Hi CW! About my reservation ${reference}`)}`;

  const html = layout(
    copy.subject,
    `<h1 style="margin:0;font-size:26px;line-height:1.25;color:${NAVY};">${esc(copy.headline)}</h1>
<p style="margin:12px 0 24px;font-size:15px;line-height:1.6;">${esc(copy.summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">
${rowsHtml(rows)}
</table>
<p style="margin:20px 0 0;padding:14px 16px;background:${MINT_SOFT};border-radius:12px;font-size:13px;color:${INK};">${esc(FULL_PRICE_NOTE)}</p>
<p style="margin:24px 0 16px;font-size:14px;">${esc(copy.contact)}</p>
<a href="${esc(whatsapp)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:${TEAL};color:#ffffff;font-weight:700;text-decoration:none;">Message us on WhatsApp</a>`,
  );

  const text = [
    copy.headline,
    "",
    copy.summary,
    "",
    rowsText(rows),
    "",
    FULL_PRICE_NOTE,
    "",
    copy.contact,
    `WhatsApp: ${whatsapp}`,
  ].join("\n");

  return { subject: oneLine(copy.subject), html, text };
}

/* ── admin ─────────────────────────────────────────────────────────────────── */

/**
 * Clay's alert. Ordered for acting on it: who to call, which car, when and
 * where it changes hands, then money, then whatever the guest wrote. The link
 * opens the booking in the back office (login required; the URL alone reveals
 * nothing). `adminUrl` is null when the site origin could not be determined,
 * and the email then says where to find it instead of printing a broken link.
 *
 * `specialRequests` is passed in rather than read off the confirmation: the
 * confirmation is what the guest's browser receives, and it has no need of it.
 */
export function renderAdminAlert(
  c: BookingConfirmation,
  extra: { adminUrl: string | null; specialRequests: string | null },
): RenderedEmail {
  const { adminUrl } = extra;
  const reference = bookingReference(c.bookingId);
  const pickupDay = fmtDay(fromKey(c.pickupDate));
  const returnDay = fmtDay(fromKey(c.returnDate));
  const dayCount = `${c.days} ${c.days === 1 ? "day" : "days"}`;

  const rows: ConfirmationRow[] = [
    { label: "Guest", value: c.client.full_name, details: [] },
    { label: "Phone", value: c.client.phone, details: [] },
    { label: "Email", value: c.client.email, details: [] },
    {
      label: "Car",
      value: `${c.car.model}, ${c.car.color.toLowerCase()} · ${c.car.transmission}`,
      details: [],
    },
    {
      label: "Pickup",
      value: `${pickupDay} at ${fmtTime(c.pickupTime)}`,
      details: [{ text: c.pickupLocation }],
    },
    {
      label: "Drop-off",
      value: `${returnDay} at ${fmtTime(c.returnTime)}`,
      details: [{ text: c.returnLocation }],
    },
  ];
  if (c.flightNumber) rows.push({ label: "Flight", value: c.flightNumber, details: [] });
  rows.push(
    {
      label: "Rental",
      value: c.rentalType === "monthly" ? `Monthly · ${c.days} day period` : `Daily · ${dayCount}`,
      details: [],
    },
    {
      label: "Total",
      value: formatMoney(c.totalCents),
      details:
        c.discountCents > 0
          ? [
              {
                text: `${c.discountPct}% discount, ${formatMoney(c.discountCents)} off`,
                emphasis: true,
              },
            ]
          : [],
    },
    {
      label: "Payment",
      // A booking this fresh is always unpaid; the fallback is for the day it isn't.
      value:
        c.paymentStatus === "unpaid"
          ? "Unpaid, due at pickup"
          : paymentLabel(c.paymentStatus).label,
      details: [],
    },
    { label: "Reference", value: reference, details: [] },
  );
  const requests = extra.specialRequests?.trim() || null;
  const subject = oneLine(
    `New booking: ${c.client.full_name}, ${c.car.model}, ${pickupDay} to ${returnDay}`,
  );
  const where = adminUrl
    ? `<a href="${esc(adminUrl)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:${NAVY};color:#ffffff;font-weight:700;text-decoration:none;">Open in the back office</a>`
    : `<p style="margin:0;font-size:14px;">Find it in the back office under Bookings, reference ${esc(reference)}.</p>`;

  const html = layout(
    subject,
    `<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TEAL_DARK};">New booking · confirmed</p>
<h1 style="margin:8px 0 20px;font-size:22px;line-height:1.3;color:${NAVY};">${esc(c.client.full_name)} · ${esc(c.car.model)}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">
${rowsHtml(rows)}
</table>
${
  requests
    ? `<p style="margin:20px 0 0;font-weight:700;color:${NAVY};font-size:14px;">Guest's note</p>
<p style="margin:6px 0 0;padding:12px 14px;background:${MINT_SOFT};border-radius:12px;font-size:14px;white-space:pre-wrap;">${esc(requests)}</p>`
    : ""
}
<div style="margin-top:24px;">${where}</div>`,
  );

  const text = [
    `New booking, confirmed: ${c.client.full_name} · ${c.car.model}`,
    "",
    rowsText(rows),
    ...(requests ? ["", "Guest's note:", requests] : []),
    "",
    adminUrl
      ? `Open: ${adminUrl}`
      : `Find it in the back office under Bookings, reference ${reference}.`,
  ].join("\n");

  return { subject, html, text };
}
