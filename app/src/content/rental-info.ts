/**
 * The rental conditions a guest should see BEFORE they book, said the same way
 * everywhere: the fleet section, the booking page, the wizard, the confirmation
 * screen and the confirmation email all read from this file.
 *
 * These are summaries of the General Rental Terms & Conditions
 * (src/content/legal/terms.ts), which remain the authority. If Clay changes the
 * terms, change them there first and then here.
 */

/** Terms section 3.1. Display only: the site does not ask for a date of birth,
 *  so nothing here is validated; the licence is checked at handover. */
export const MIN_RENTAL_AGE = 21

/** The exact line, wherever it appears. */
export const MIN_AGE_NOTE = `Minimum rental age: ${MIN_RENTAL_AGE} years`
