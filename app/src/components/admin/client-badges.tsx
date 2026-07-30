/**
 * The two badges a guest carries. Presentational only.
 *
 * Both are COMPUTED at read time — a rental count and a date comparison — so
 * neither can be stale, and neither is a column anyone can set by hand. The
 * rules live in src/lib/admin/clients.ts; this file only decides what they look
 * like.
 */
import { formatDateShort } from "../../lib/admin/format";
import { LICENCE_LABEL, type LicenceLevel } from "../../lib/admin/clients";

/** Repeat customer. The count is on the badge because "came back once" and
 *  "has rented eleven times" are different conversations. */
export function RepeatBadge({ rentals }: { rentals: number }) {
  return (
    <span
      title={`${rentals} rentals with CW, cancellations excluded`}
      className="inline-flex items-center gap-1 rounded-md bg-cw-teal-soft px-1.5 py-0.5 text-[11px] font-semibold text-cw-teal-dark ring-1 ring-inset ring-cw-teal/25"
    >
      <span aria-hidden>★</span> Repeat · {rentals}
    </span>
  );
}

/**
 * Licence state. Renders nothing for a valid licence: a badge on every row is
 * decoration, and the point of this one is to be noticed.
 *
 * `missing` is shown but muted — it is normal for an online booking that has not
 * reached the counter yet, and it is still worth seeing before someone drives
 * to the airport with a set of keys.
 */
export function LicenceBadge({ level, expiry }: { level: LicenceLevel; expiry: string | null }) {
  if (level === "ok") return null;

  const tone =
    level === "expired" || level === "expires_mid_hire"
      ? "bg-[#fdecec] text-[#b3261e] ring-[#b3261e]/20"
      : level === "expiring"
        ? "bg-cw-yellow-soft text-[#8a6a04] ring-cw-yellow/45"
        : "bg-cw-navy/6 text-cw-navy/60 ring-cw-navy/10";

  return (
    <span
      title={
        expiry
          ? `${LICENCE_LABEL[level]} — expires ${formatDateShort(expiry)}`
          : LICENCE_LABEL[level]
      }
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
    >
      {LICENCE_LABEL[level]}
      {expiry && level !== "missing" && (
        <span className="ml-1 font-normal opacity-80">{formatDateShort(expiry)}</span>
      )}
    </span>
  );
}
