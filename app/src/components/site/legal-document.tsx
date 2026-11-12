import type { LegalDocument } from '../../content/legal/types'

/**
 * Lays out a legal document from src/content/legal/. Formatting only: this
 * component never rewrites, trims or reorders the text it is given.
 *
 * Built for reading on a phone: one column, generous line height, clause
 * numbers inline so nothing needs a second column that would squeeze the text.
 */
export default function LegalDocumentPage({ doc }: { doc: LegalDocument }) {
  return (
    <main className="min-h-dvh bg-[#f5f8f8] pt-[72px]">
      <article className="mx-auto max-w-[780px] px-5 pb-24 pt-12 md:px-8 md:pt-16">
        {doc.draft && (
          <p
            role="note"
            className="mb-8 rounded-xl border-2 border-[#b3271d]/50 bg-[#fdeceb] px-4 py-3 text-sm font-semibold text-[#b3271d]"
          >
            DRAFT PLACEHOLDER. This is not the final document and must not be relied on.
          </p>
        )}
        <header className="border-b-2 border-cw-teal pb-6 text-center">
          {doc.letterhead?.map((line, i) => (
            <p
              key={line}
              className={
                i === 0
                  ? 'font-display text-sm font-bold uppercase tracking-widest text-cw-teal-dark'
                  : 'mt-1 text-sm italic text-cw-teal-dark/90'
              }
            >
              {line}
            </p>
          ))}
          <h1 className="mt-4 font-display text-[clamp(1.6rem,3.2vw,2.4rem)] font-extrabold leading-tight tracking-tight text-cw-navy">
            {doc.title}
          </h1>
        </header>

        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-cw-ink/90 md:text-base">
          {doc.intro.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="font-display text-xl font-extrabold tracking-tight text-cw-teal-dark">
              {section.heading}
            </h2>
            <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-cw-ink/90 md:text-base">
              {section.blocks.map((block, i) =>
                block.kind === 'list' ? (
                  <ul key={i} className="list-disc space-y-2 pl-6">
                    {block.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i}>
                    {block.number && (
                      <span className="mr-2 font-bold text-cw-navy">{block.number}</span>
                    )}
                    {block.text}
                  </p>
                ),
              )}
            </div>
          </section>
        ))}

        {doc.footer && (
          <p className="mt-12 border-t-2 border-cw-teal pt-4 text-sm italic text-cw-ink/70">
            {doc.footer}
          </p>
        )}
      </article>
    </main>
  )
}
