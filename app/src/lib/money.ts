/**
 * Money. One currency, one place it becomes a string.
 *
 * CW prices in XCG — the Caribbean guilder, the currency of Curaçao. Every
 * amount in this codebase is an integer of CENTS (matching the database), and
 * the ONLY place cents become a displayable string is here. Never divide by 100
 * in a component.
 *
 * WHY THIS FORMATS BY HAND INSTEAD OF `Intl` CURRENCY STYLE
 * `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCG' })`
 * renders "Cg. 60" on a current ICU and "XCG 60" on an older one. Two problems
 * with that, and the second is a real bug rather than a preference:
 *
 *   1. XCG is what the business quotes in and what guests are told, so that is
 *      what the site should print.
 *   2. This app renders on the server and hydrates in the browser. Those two
 *      ICU builds are not the same build. A currency symbol that differs
 *      between them is a hydration mismatch on every price on the page.
 *
 * So the digits go through Intl (grouping and rounding are worth borrowing) and
 * the currency token is a literal. Same string on both sides, always.
 */

/** ISO 4217 code for the Caribbean guilder. The visible token, deliberately. */
export const CURRENCY_CODE = "XCG";

const grouped = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const groupedPrecise = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Cents → "XCG 1,240", or "XCG 1,240.50" when the cents are not round.
 *
 * Whole guilders are the overwhelming case — rates are set in whole guilders —
 * and dropping a column of ".00"s makes a wall of figures much faster to scan.
 */
export function formatMoney(cents: number): string {
  return `${CURRENCY_CODE} ${
    cents % 100 === 0 ? grouped.format(cents / 100) : groupedPrecise.format(cents / 100)
  }`;
}

/** Always two decimals. For a single figure being reconciled against a receipt,
 *  where the trailing zeros are the point. */
export function formatMoneyExact(cents: number): string {
  return `${CURRENCY_CODE} ${groupedPrecise.format(cents / 100)}`;
}

/** Just the digits, no currency token — for a field that already has "XCG"
 *  printed beside the input, where repeating it would read as part of the value. */
export function formatAmount(cents: number): string {
  return cents % 100 === 0 ? grouped.format(cents / 100) : groupedPrecise.format(cents / 100);
}
