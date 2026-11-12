import { INSURANCE } from '../../content/rental-info'
import { TERMS_LINK_LABEL } from '../../content/legal/terms'

/**
 * The insurance information, the same words wherever it is shown.
 *
 * The one-sentence summary is always visible; what is covered, what is not and
 * what the renter is liable for sit in a native <details> so the section stays
 * short on a phone without hiding anything behind script. All wording comes
 * from INSURANCE in src/content/rental-info.ts (Clay's document, verbatim).
 */
export default function InsuranceInfo({
  className = '',
  /** Open the Terms in a new tab. Used inside the wizard, where navigating
   *  away would throw the booking in progress away. */
  newTab = false,
}: {
  className?: string
  newTab?: boolean
}) {
  const list = 'mt-1.5 list-disc space-y-1 pl-5'
  return (
    <div className={`rounded-xl bg-white p-5 text-left text-sm leading-relaxed text-cw-ink/85 shadow-[0_2px_10px_rgba(2,48,71,0.06)] ${className}`}>
      <p className="font-display text-sm font-bold uppercase tracking-widest text-cw-teal-dark">
        {INSURANCE.heading}
      </p>
      <p className="mt-2 font-semibold text-cw-navy">{INSURANCE.summary}</p>

      <details className="group mt-3">
        <summary className="cursor-pointer font-semibold text-cw-teal underline decoration-cw-teal/40 underline-offset-4 hover:text-cw-teal-dark">
          What is and is not covered
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="font-semibold text-cw-navy">{INSURANCE.coversLead}</p>
            <ul className={list}>
              {INSURANCE.covers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-cw-navy">{INSURANCE.excludesLead}</p>
            <ul className={list}>
              {INSURANCE.excludes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p>{INSURANCE.ownCover}</p>
          <div>
            <p className="font-semibold text-cw-navy">{INSURANCE.liabilityHeading}</p>
            <p className="mt-1.5">{INSURANCE.liabilityLead}</p>
            <dl className="mt-2 divide-y divide-cw-navy/10 border-y border-cw-navy/10">
              {INSURANCE.liability.map((row) => (
                <div key={row.situation} className="grid gap-1 py-2 sm:grid-cols-[1fr_1.4fr] sm:gap-4">
                  <dt className="font-semibold text-cw-navy">{row.situation}</dt>
                  <dd>{row.liability}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="font-semibold text-cw-navy">{INSURANCE.crs}</p>
        </div>
      </details>

      <p className="mt-3 text-[13px] text-cw-ink/70">
        {INSURANCE.more}{' '}
        <a
          href="/terms"
          {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="font-semibold text-cw-teal underline decoration-cw-teal/40 underline-offset-4 hover:text-cw-teal-dark"
        >
          {TERMS_LINK_LABEL}
        </a>
        .
      </p>
    </div>
  )
}
