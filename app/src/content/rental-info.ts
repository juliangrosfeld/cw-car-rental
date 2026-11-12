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

/**
 * Insurance, as shown on the public site and in the booking summary.
 *
 * EVERY SENTENCE HERE IS CLAY'S, NOT OURS. The wording is taken verbatim from
 * "Insurance Cover and Accident Procedure" (CW_Insurance_and_Accidents-2,
 * sections 1 to 3 and 6), which is itself a summary of sections 3, 7 and 8 of
 * the Terms & Conditions. Nothing is paraphrased, and no cover, limit or
 * own-risk amount appears that is not in that document. Do not "improve" it:
 * a friendlier sentence that says something slightly different is a promise
 * CW never made.
 */
export const INSURANCE = {
  heading: 'Insurance',
  summary:
    'Each CW vehicle is insured under WA Extra third-party liability insurance in accordance with Curaçao law.',
  coversLead: 'The insurance covers:',
  covers: [
    'the Renter’s legal liability for damage caused by the vehicle to the property of third parties; and',
    'the repair of the vehicle where another party is at fault.',
  ],
  excludesLead: 'The insurance does not cover:',
  excludes: [
    'fire, theft or glass breakage;',
    'damage to the vehicle where the Renter, or an unlisted or unfit driver, is at fault; or',
    'bodily injury to any person, including the Renter, any driver, any passenger and the other party.',
  ],
  ownCover:
    'The Renter is responsible for arranging personal accident, health or travel insurance, if desired. CW does not sell or arrange additional insurance. Any supplementary cover must be arranged separately at the Renter’s own cost.',
  liabilityHeading: 'Renter’s Liability',
  liabilityLead:
    'Where the Renter is at fault, or where fault cannot be established, the Renter is liable for the actual cost of repairing the vehicle, including the own-risk (eigen risico), subject to the maximum stated below.',
  liability: [
    {
      situation: 'Renter at fault, or fault cannot be established',
      liability: 'Actual repair cost, including the own-risk, up to a maximum of XCG 3,000 per incident',
    },
    {
      situation: 'Own-risk (eigen risico)',
      liability: 'XCG 350 (XCG 475 where the driver at fault is under 23 years of age)',
    },
    {
      situation: 'Third party established as being at fault',
      liability:
        'The Renter is not liable for repair costs. CW pursues recovery from that party or their insurer',
    },
  ],
  crs: 'If CRS is not contacted and no CRS report is made, the insurance does not cover the damage and the Renter is personally liable for the full repair or replacement cost, regardless of fault.',
  /** Our own pointer to the authority, not part of Clay's text. */
  more: 'The full insurance and accident terms are in sections 7 and 8 of the',
} as const
