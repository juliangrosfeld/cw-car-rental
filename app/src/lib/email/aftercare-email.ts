/**
 * The after-care email: sent once, when a booking is marked Returned.
 *
 * THE BODY IS CLAY'S TEXT, WORD FOR WORD. He wrote it; this file only fills in
 * three things: the guest's first name, the Google review link, and CW's
 * WhatsApp number (from CONTACT, so it follows the number if it ever changes).
 * Do not reword it, tidy its punctuation, add a sentence or "warm it up". If
 * the wording needs to change, it changes because Clay sent new wording.
 *
 * Pure, like booking-emails.ts: no I/O and no env. Whether to send, and to
 * whom, is decided in ./notify-aftercare.server.
 */
import { BUSINESS_NAME, CONTACT, EMAIL_HREF } from "../../content/brand";
import type { RenderedEmail } from "./booking-emails";

export const AFTERCARE_SUBJECT = `Thank you for renting with ${BUSINESS_NAME}`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Clay's text as paragraphs. The review link is its own paragraph, marked so
 * the HTML version can make it clickable; every other line is plain text.
 */
function paragraphs(name: string, reviewUrl: string): ({ text: string } | { link: string })[] {
  const phone = CONTACT.phone;
  return [
    {
      text: `Hi ${name}, thank you for renting with ${BUSINESS_NAME}. It was a pleasure having you on the island, and we hope the car made your trip easier.`,
    },
    {
      text: "We would be very grateful if you could take a minute to leave us a short Google review. It helps us improve and helps other visitors find us:",
    },
    { link: reviewUrl },
    {
      text: `If anything was not right, please reply here or message us on WhatsApp at ${phone}. We'll do our best to make it right.`,
    },
    {
      text: "If you or your friends and family come back to Curaçao, we'd be glad to welcome you again.",
    },
    {
      text: ["Warm regards,", "Clay Winklaar", `${BUSINESS_NAME}, Curaçao`, `WhatsApp ${phone}`].join(
        "\n",
      ),
    },
  ];
}

export function renderAftercare(input: { firstName: string; reviewUrl: string }): RenderedEmail {
  const parts = paragraphs(input.firstName, input.reviewUrl);

  const text = parts.map((p) => ("link" in p ? p.link : p.text)).join("\n\n");

  const body = parts
    .map((p) =>
      "link" in p
        ? `<p style="margin:0 0 18px;"><a href="${esc(p.link)}" style="color:#0c6b6b;font-weight:700;word-break:break-all;">${esc(p.link)}</a></p>`
        : `<p style="margin:0 0 18px;">${esc(p.text).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");

  // Deliberately plain: a letter from Clay, not a marketing template. One
  // readable column, system fonts, no images to be blocked.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(AFTERCARE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c3a4a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;">
<tr><td style="padding:32px 28px 14px;font-size:16px;line-height:1.65;">
${body}
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#7a8f99;">${esc(BUSINESS_NAME)} · <a href="${esc(EMAIL_HREF)}" style="color:#7a8f99;">${esc(CONTACT.email)}</a></p>
</td></tr>
</table>
</body>
</html>`;

  return { subject: AFTERCARE_SUBJECT, html, text };
}
